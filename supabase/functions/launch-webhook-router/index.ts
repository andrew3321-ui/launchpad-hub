// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ProcessContactError,
  processIncomingContactEvent,
  type IncomingEventBody,
} from "../_shared/contact-processing.ts";
import { appendGoogleSheetsRow, parseGoogleSheetsConfig } from "../_shared/google-sheets.ts";

type JsonRecord = Record<string, unknown>;
type AnySupabaseClient = any;
type WebhookSource =
  | "activecampaign"
  | "manychat"
  | "typebot"
  | "tally"
  | "sendflow"
  | "uchat";

interface LaunchRow {
  id: string;
  slug: string | null;
  name: string;
  webhook_secret: string;
  ac_api_url: string | null;
  ac_api_key: string | null;
  ac_default_list_id: string | null;
  ac_named_tags: unknown;
  current_cycle_number: number;
  gs_enabled: boolean;
  gs_auth_mode: "service_account" | "oauth" | null;
  gs_oauth_email: string | null;
  gs_oauth_refresh_token: string | null;
  gs_service_account_email: string | null;
  gs_private_key: string | null;
  gs_spreadsheet_id: string | null;
  gs_spreadsheet_title: string | null;
  gs_sheet_name: string | null;
}

interface LeadContactRow {
  id: string;
  primary_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  normalized_phone: string | null;
  data: unknown;
}

interface UChatWorkspaceRow {
  id: string;
  workspace_name: string;
  workspace_id: string | null;
  api_token: string;
  welcome_subflow_ns: string | null;
  default_tag_name: string | null;
}

interface RoutingActionRow {
  id: string;
  status?: "pending" | "success" | "failed" | "skipped";
  created_at?: string;
}

interface NamedTag {
  alias: string;
  tag: string;
}

interface ActiveCampaignFieldValueInput {
  fieldId: string;
  value: string;
}

interface UchatSubscriberLookup {
  workspace: UChatWorkspaceRow;
  userNs: string;
  userId: string | null;
  snapshot: JsonRecord;
  currentTags: string[];
}

interface ResolvedUchatRecipient {
  userNs: string;
  userId: string | null;
  snapshot: JsonRecord | null;
  resolutionSource: string;
}

interface NormalizedWebhookEvent {
  source: WebhookSource;
  eventType: string;
  externalContactId: string | null;
  contact: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  payload: JsonRecord;
}

interface LaunchWebhookJobRow {
  id: string;
  launch_id: string;
  source: WebhookSource;
  event_type: string | null;
  payload: JsonRecord;
  status: "pending" | "running" | "success" | "failed";
  attempts: number;
  updated_at?: string | null;
}

interface RouteToUchatOptions {
  allowSubflow?: boolean;
  allowWorkspaceDefaultSubflow?: boolean;
  allowTag?: boolean;
  requireExplicitRecipient?: boolean;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROUTING_PENDING_TIMEOUT_MS = 5 * 60 * 1000;
const ACTIVECAMPAIGN_REQUEST_RETRIES = 2;
const activeCampaignTagCache = new Map<string, Array<{ id: string; tag: string }>>();
const DEFAULT_TYPEBOT_ACTIVECAMPAIGN_TAG_IDS = ["1050", "1055"] as const;
const DEFAULT_TYPEBOT_UTM_FIELD_IDS = {
  utm_source: "21",
  utm_medium: "22",
  utm_content: "25",
  utm_campaign: "23",
  utm_term: "24",
  utm_site: "60",
} as const;
const DEFAULT_MANYCHAT_ACTIVECAMPAIGN_TAG_IDS = ["1050", "1053"] as const;
const DEFAULT_MANYCHAT_ACTIVECAMPAIGN_FIELD_VALUES = {
  "21": "ORG-IG-AUT",
  "22": "LANC-26-03",
  "23": "SJL-CAPTACAO",
  "24": "INT-GERAL",
  "60": "AUT",
} as const;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isLikelyUchatUserNs(value: unknown) {
  const normalized = nonEmptyString(value);
  return Boolean(normalized && normalized.length >= 6 && /^f/i.test(normalized) && !/^\d+$/.test(normalized));
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map(nonEmptyString).filter((value): value is string => Boolean(value)))];
}

function digitsOnly(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const digits = String(value).replace(/\D/g, "");
  return digits || null;
}

function addBrazilianPhoneNinthDigitVariants(localDigits: string) {
  const variants = new Set<string>([localDigits]);

  if (/^[1-9]{2}[6-9]\d{7}$/.test(localDigits)) {
    variants.add(`${localDigits.slice(0, 2)}9${localDigits.slice(2)}`);
  }

  if (/^[1-9]{2}9[6-9]\d{7}$/.test(localDigits)) {
    variants.add(`${localDigits.slice(0, 2)}${localDigits.slice(3)}`);
  }

  return [...variants];
}

function buildPhoneSearchCandidates(values: Array<string | null | undefined>) {
  const candidates = new Set<string>();

  for (const value of values) {
    const raw = nonEmptyString(value);
    const digits = digitsOnly(raw);

    if (raw) candidates.add(raw);
    if (!digits) continue;

    candidates.add(digits);
    candidates.add(`+${digits}`);

    const localDigits = digits.startsWith("55") && digits.length > 11
      ? digits.slice(2)
      : digits;

    for (const localVariant of addBrazilianPhoneNinthDigitVariants(localDigits)) {
      candidates.add(localVariant);
      candidates.add(`55${localVariant}`);
      candidates.add(`+55${localVariant}`);
    }
  }

  return uniqueStrings([...candidates]).slice(0, 18);
}

function phonesLookEquivalent(left: unknown, right: unknown) {
  const leftDigits = digitsOnly(left);
  const rightDigits = digitsOnly(right);

  if (!leftDigits || !rightDigits) return false;
  if (leftDigits === rightDigits) return true;

  return (
    leftDigits.length >= 10 &&
    rightDigits.length >= 10 &&
    (leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits))
  );
}

function buildBrazilianLocalPhoneVariants(rawDigits: string) {
  const trimmedDigits = rawDigits.replace(/^0+/, "");
  const localDigits = trimmedDigits.startsWith("55") && trimmedDigits.length > 11
    ? trimmedDigits.slice(2)
    : trimmedDigits;

  return addBrazilianPhoneNinthDigitVariants(localDigits)
    .filter((value) => /^[1-9]{2}9?\d{8}$/.test(value))
    .sort((left, right) => right.length - left.length);
}

function buildUchatPhoneCandidates(value: unknown) {
  const raw = nonEmptyString(value);
  const digits = digitsOnly(raw);

  if (!digits) return [] as string[];

  const candidates = new Set<string>();
  for (const localVariant of buildBrazilianLocalPhoneVariants(digits)) {
    candidates.add(`+55${localVariant}`);
    candidates.add(`55${localVariant}`);
  }

  if (/^\+[1-9]\d{7,14}$/.test(raw || "")) {
    candidates.add(raw as string);
  }

  if (/^[1-9]\d{7,14}$/.test(digits)) {
    candidates.add(`+${digits}`);
    candidates.add(digits);
  }

  return uniqueStrings([...candidates]).slice(0, 12);
}

function pickPreferredUchatCreatePhone(value: unknown) {
  return buildUchatPhoneCandidates(value).find((candidate) => /^\+[1-9]\d{7,14}$/.test(candidate)) || null;
}

function splitName(fullName?: string | null) {
  const value = nonEmptyString(fullName);
  if (!value) return { firstName: null, lastName: null };

  const parts = value.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || null,
    lastName: parts.slice(1).join(" ") || null,
  };
}

function assignNestedValue(target: JsonRecord, key: string, value: string) {
  const tokens = key
    .replace(/\]/g, "")
    .split(/\[|\./)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return;

  let current: JsonRecord = target;
  tokens.forEach((token, index) => {
    if (index === tokens.length - 1) {
      current[token] = value;
      return;
    }

    if (!isRecord(current[token])) {
      current[token] = {};
    }

    current = current[token] as JsonRecord;
  });
}

function parseUrlEncodedBody(text: string) {
  const params = new URLSearchParams(text);
  const payload: JsonRecord = {};

  for (const [key, value] of params.entries()) {
    assignNestedValue(payload, key, value);
  }

  return payload;
}

async function parseRequestBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const rawText = await request.text();

  if (!rawText.trim()) {
    return {} as JsonRecord;
  }

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(rawText) as JsonRecord;
    } catch {
      throw new ProcessContactError("Invalid JSON body", 400);
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return parseUrlEncodedBody(rawText);
  }

  try {
    return JSON.parse(rawText) as JsonRecord;
  } catch {
    return parseUrlEncodedBody(rawText);
  }
}

function findStringDeep(node: unknown, keys: string[]): string | null {
  const normalizedKeys = new Set(keys.map(normalizeKey));

  function walk(value: unknown): string | null {
    if (Array.isArray(value)) {
      for (const item of value) {
        const nested = walk(item);
        if (nested) return nested;
      }
      return null;
    }

    if (!isRecord(value)) return null;

    for (const [key, nestedValue] of Object.entries(value)) {
      if (normalizedKeys.has(normalizeKey(key))) {
        if (typeof nestedValue === "string" || typeof nestedValue === "number") {
          return String(nestedValue).trim() || null;
        }
      }

      const nested = walk(nestedValue);
      if (nested) return nested;
    }

    return null;
  }

  return walk(node);
}

function readNestedBracketValue(source: unknown, key: string) {
  if (!isRecord(source)) return null;

  const tokens = key
    .replace(/\]/g, "")
    .split(/\[|\./)
    .map((token) => token.trim())
    .filter(Boolean);

  let current: unknown = source;
  for (const token of tokens) {
    if (!isRecord(current)) return null;
    current = current[token];
  }

  return current;
}

function getActiveCampaignBodyValue(payload: JsonRecord, key: string) {
  const body = isRecord(payload.body) ? payload.body : payload;
  const directValue =
    body[key] ??
    payload[key] ??
    readNestedBracketValue(body, key) ??
    readNestedBracketValue(payload, key);

  if (typeof directValue === "string" || typeof directValue === "number" || typeof directValue === "boolean") {
    const normalized = String(directValue).trim();
    return normalized || null;
  }

  return null;
}

function getActiveCampaignContactField(payload: JsonRecord, fieldName: string) {
  return (
    getActiveCampaignBodyValue(payload, `contact[fields][${fieldName}]`) ||
    findStringDeep(payload, [fieldName])
  );
}

function formatGoogleSheetsPhone(contact: LeadContactRow, payload: JsonRecord) {
  const rawPhone =
    getActiveCampaignBodyValue(payload, "contact[phone]") ||
    contact.primary_phone ||
    contact.normalized_phone ||
    "";
  const digits = rawPhone.replace(/\D/g, "");

  if (!digits) return rawPhone || null;
  if (digits.startsWith("55")) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;

  return digits;
}

function buildActiveCampaignSheetsRow(launch: LaunchRow, contact: LeadContactRow, payload: JsonRecord) {
  const firstName = getActiveCampaignBodyValue(payload, "contact[first_name]");
  const lastName = getActiveCampaignBodyValue(payload, "contact[last_name]");
  const name = uniqueStrings([
    [firstName, lastName].filter(Boolean).join(" "),
    contact.primary_name,
  ])[0] || null;

  return {
    header: [
      "Data",
      "Nome",
      "Email",
      "Telefone",
      "Tipo de Lead",
      "Produto",
      "UTM SOURCE",
      "UTM CAMPAIGN",
      "UTM MEDIUM",
      "UTM CONTENT",
      "UTM TERM",
      "UTM SITE",
      "Data do Cadastro",
      "Vlr Dash",
      "HOTLEAD",
      "vk_source",
      "vk_ad_id",
    ],
    row: [
      getActiveCampaignContactField(payload, "data_evento"),
      name,
      getActiveCampaignBodyValue(payload, "contact[email]") || contact.primary_email,
      formatGoogleSheetsPhone(contact, payload),
      getActiveCampaignContactField(payload, "tipo_de_lead"),
      getActiveCampaignContactField(payload, "produto"),
      getActiveCampaignContactField(payload, "utm_source"),
      getActiveCampaignContactField(payload, "utm_campaign"),
      getActiveCampaignContactField(payload, "utm_medium"),
      getActiveCampaignContactField(payload, "utm_content"),
      getActiveCampaignContactField(payload, "utm_term"),
      getActiveCampaignContactField(payload, "utm_site"),
      getActiveCampaignContactField(payload, "data_de_cadastro"),
      getActiveCampaignContactField(payload, "dashboard_value") || "1",
      getActiveCampaignContactField(payload, "hotlead"),
      getActiveCampaignContactField(payload, "vk_source"),
      getActiveCampaignContactField(payload, "vk_ad_id"),
    ],
    metadata: {
      expert: launch.name,
      cycle: launch.current_cycle_number,
    },
  };
}

function collectStringListDeep(node: unknown, keys: string[]) {
  const normalizedKeys = new Set(keys.map(normalizeKey));
  const values: string[] = [];

  function pushValue(value: unknown) {
    if (typeof value === "string") {
      value
        .split(/[,\n|]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => values.push(item));
      return;
    }

    if (typeof value === "number") {
      values.push(String(value));
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => pushValue(item));
    }
  }

  function walk(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item));
      return;
    }

    if (!isRecord(value)) return;

    for (const [key, nestedValue] of Object.entries(value)) {
      if (normalizedKeys.has(normalizeKey(key))) {
        pushValue(nestedValue);
      }
      walk(nestedValue);
    }
  }

  walk(node);
  return uniqueStrings(values);
}

function collectValuesDeep(node: unknown, keys: string[]) {
  const normalizedKeys = new Set(keys.map(normalizeKey));
  const values: unknown[] = [];

  function pushValue(value: unknown) {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      value.forEach((item) => values.push(item));
      return;
    }

    values.push(value);
  }

  function walk(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item));
      return;
    }

    if (!isRecord(value)) return;

    for (const [key, nestedValue] of Object.entries(value)) {
      if (normalizedKeys.has(normalizeKey(key))) {
        pushValue(nestedValue);
      }
      walk(nestedValue);
    }
  }

  walk(node);
  return values;
}

function extractGenericContact(payload: JsonRecord) {
  const name =
    findStringDeep(payload, ["name", "full_name", "fullname", "nome"]) ||
    uniqueStrings([
      findStringDeep(payload, ["first_name", "firstname", "first", "primeiro_nome"]),
      findStringDeep(payload, ["last_name", "lastname", "last", "sobrenome"]),
    ]).join(" ") ||
    null;

  return {
    name,
    email: findStringDeep(payload, ["email"]),
    phone:
      findStringDeep(payload, [
        "phone",
        "telephone",
        "telefone",
        "whatsapp",
        "whatsapp_number",
        "mobile",
        "cellphone",
        "cell",
        "celular",
        "fone",
        "tel",
        "number",
      ]) ||
      null,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) return 500 * (attempt + 1);

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const parsedDate = Date.parse(retryAfter);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }

  return 500 * (attempt + 1);
}

function stringifyScalar(value: unknown) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const normalized = String(value).trim();
    return normalized || null;
  }

  return null;
}

function resolveTallyFieldValue(field: JsonRecord) {
  const options = Array.isArray(field.options)
    ? field.options.filter(isRecord)
    : [];

  const optionLookup = new Map<string, string>();
  options.forEach((option) => {
    const optionId =
      nonEmptyString(option.id) ||
      nonEmptyString(option.value);
    const optionLabel =
      nonEmptyString(option.text) ||
      nonEmptyString(option.label) ||
      optionId;

    if (optionId && optionLabel) {
      optionLookup.set(optionId, optionLabel);
    }
  });

  const resolveSingleValue = (value: unknown) => {
    const scalar =
      stringifyScalar(value) ||
      (isRecord(value)
        ? nonEmptyString(value.text) ||
          nonEmptyString(value.label) ||
          nonEmptyString(value.value) ||
          nonEmptyString(value.id)
        : null);

    if (!scalar) return null;
    return optionLookup.get(scalar) || scalar;
  };

  if (Array.isArray(field.value)) {
    const resolvedValues = uniqueStrings(field.value.map((item) => resolveSingleValue(item)));
    return resolvedValues.length > 0 ? resolvedValues.join(", ") : null;
  }

  return resolveSingleValue(field.value);
}

function flattenTallyPayload(payload: JsonRecord) {
  const data = isRecord(payload.data) ? payload.data : null;
  const fields = Array.isArray(data?.fields)
    ? data.fields.filter(isRecord)
    : [];

  if (fields.length === 0) {
    return payload;
  }

  const byKey: JsonRecord = {};
  const byLabel: JsonRecord = {};
  const normalizedFields: JsonRecord = {};
  const answers: JsonRecord[] = [];

  fields.forEach((field) => {
    const key = nonEmptyString(field.key);
    const label = nonEmptyString(field.label);
    const type = nonEmptyString(field.type);
    const value = resolveTallyFieldValue(field);

    if (!value) return;

    if (key) {
      byKey[key] = value;
      normalizedFields[key] = value;
      normalizedFields[normalizeKey(key)] = value;
    }

    if (label) {
      byLabel[label] = value;
      normalizedFields[label] = value;
      normalizedFields[normalizeKey(label)] = value;
    }

    answers.push({
      ...(key ? { key } : {}),
      ...(label ? { label } : {}),
      ...(type ? { type } : {}),
      value,
    });
  });

  return {
    ...payload,
    tally_fields: normalizedFields,
    tally_fields_by_key: byKey,
    tally_fields_by_label: byLabel,
    tally_answers: answers,
  } satisfies JsonRecord;
}

function normalizeWebhookSource(value: string | null) {
  if (!value) return null;
  const normalized = normalizeKey(value);

  if (normalized === "activecampaign") return "activecampaign";
  if (normalized === "manychat") return "manychat";
  if (normalized === "typebot") return "typebot";
  if (normalized === "tally") return "tally";
  if (normalized === "sendflow") return "sendflow";
  if (normalized === "uchat") return "uchat";

  return null;
}

function normalizeIncomingWebhook(
  source: WebhookSource,
  payload: JsonRecord,
): NormalizedWebhookEvent {
  const contact = extractGenericContact(payload);
  const eventType =
    findStringDeep(payload, ["event_type", "event", "type", "trigger_name"]) ||
    "webhook_received";

  const externalContactId =
    findStringDeep(payload, [
      "external_contact_id",
      "contact_id",
      "user_ns",
      "uchat_user_ns",
      "user_id",
      "contactid",
      "id",
      "result_id",
    ]) || null;

  if (source === "activecampaign") {
    return {
      source,
      eventType,
      externalContactId,
      contact: {
        name:
          uniqueStrings([
            findStringDeep(payload, ["first_name", "firstname"]),
            findStringDeep(payload, ["last_name", "lastname"]),
          ]).join(" ") || contact.name,
        email: findStringDeep(payload, ["email"]) || contact.email,
        phone: findStringDeep(payload, ["phone"]) || contact.phone,
      },
      payload,
    };
  }

  if (source === "tally") {
    const tallyPayload = flattenTallyPayload(payload);
    const tallyContact = extractGenericContact(tallyPayload);

    return {
      source,
      eventType,
      externalContactId:
        findStringDeep(tallyPayload, [
          "response_id",
          "submission_id",
          "respondent_id",
          "external_contact_id",
          "contact_id",
          "user_id",
          "id",
        ]) || externalContactId,
      contact: {
        name: tallyContact.name,
        email: tallyContact.email,
        phone: tallyContact.phone,
      },
      payload: tallyPayload,
    };
  }

  if (source === "sendflow") {
    const sendflowNumber = findStringDeep(payload, ["number"]);
    return {
      source,
      eventType,
      externalContactId: sendflowNumber || externalContactId,
      contact: {
        name: contact.name,
        email: contact.email,
        phone: sendflowNumber || contact.phone,
      },
      payload,
    };
  }

  if (source === "uchat") {
    return {
      source,
      eventType,
      externalContactId: extractUchatUserNs(payload) || null,
      contact,
      payload,
    };
  }

  return {
    source,
    eventType,
    externalContactId,
    contact,
    payload,
  };
}

async function requestJson(
  url: string,
  init: RequestInit,
) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= ACTIVECAMPAIGN_REQUEST_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const rawText = await response.text();
      let parsed: unknown = {};

      if (rawText.trim()) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = { rawText };
        }
      }

      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < ACTIVECAMPAIGN_REQUEST_RETRIES) {
          await delay(parseRetryAfterMs(response, attempt));
          continue;
        }

        throw new Error(`HTTP ${response.status}: ${rawText}`);
      }

      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < ACTIVECAMPAIGN_REQUEST_RETRIES) {
        await delay(500 * (attempt + 1));
      }
    }
  }

  throw lastError || new Error("Unknown request error");
}

function extractUchatUserNs(payload?: JsonRecord | null) {
  if (!payload) return null;
  const candidate = findStringDeep(payload, ["uchat_user_ns", "user_ns", "subscriber.user_ns"]);
  return isLikelyUchatUserNs(candidate) ? candidate : null;
}

function extractUchatUserId(payload?: JsonRecord | null) {
  if (!payload) return null;
  return findStringDeep(payload, ["user_id", "subscriber.user_id", "subscriber.userId"]);
}

function extractKnownUchatUserId(payload?: JsonRecord | null) {
  if (!payload) return null;
  return (
    findStringDeep(payload, ["user_id", "userId", "subscriber.user_id", "subscriber.userId", "subscriber.id"]) ||
    nonEmptyString(payload.id)
  );
}

function resolveInboundDeliveryKey(
  source: WebhookSource,
  payload: JsonRecord,
  fallbackEventId: string,
) {
  if (source === "sendflow") {
    const providerEventId = findStringDeep(payload, ["id", "event_id", "webhook_id"]);
    if (providerEventId) {
      return `${source}:${providerEventId}`;
    }
  }

  return fallbackEventId;
}

function assertUchatApiSuccess(response: unknown) {
  if (!isRecord(response)) return;

  const hasExplicitFailure =
    response.success === false ||
    response.ok === false ||
    response.status === false ||
    response.error === true;

  const errorMessage =
    nonEmptyString(response.message) ||
    nonEmptyString(response.error_message) ||
    nonEmptyString(response.error) ||
    null;

  const hasStructuredPayload =
    Array.isArray(response.data) ||
    isRecord(response.data) ||
    isRecord(response.subscriber) ||
    Boolean(nonEmptyString(response.user_ns)) ||
    Boolean(nonEmptyString(response.id));

  const messageLooksFatal = errorMessage
    ? /\b(error|invalid|expired|forbidden|unauthorized|denied|failed)\b/i.test(errorMessage)
    : false;

  if (hasExplicitFailure || (messageLooksFatal && !hasStructuredPayload)) {
    throw new Error(errorMessage || "UChat returned an error response");
  }
}

function normalizeActiveCampaignBaseUrl(apiUrl: string) {
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/3") ? trimmed.slice(0, -6) : trimmed;
}

async function activeCampaignRequest(
  apiUrl: string,
  apiKey: string,
  path: string,
  method = "GET",
  body?: unknown,
  query: Record<string, string | number | undefined> = {},
) {
  const url = new URL(`${normalizeActiveCampaignBaseUrl(apiUrl)}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return await requestJson(url.toString(), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Api-Token": apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function uchatRequest(
  apiToken: string,
  path: string,
  method = "GET",
  body?: unknown,
  query: Record<string, string | number | undefined> = {},
) {
  const url = new URL(`https://www.uchat.com.au/api${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await requestJson(url.toString(), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  assertUchatApiSuccess(response);
  return response;
}

function parseNamedTags(value: unknown) {
  if (!Array.isArray(value)) return [] as NamedTag[];

  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const alias = nonEmptyString(item.alias);
      const tag = nonEmptyString(item.tag);
      if (!alias || !tag) return null;
      return { alias, tag };
    })
    .filter((item): item is NamedTag => Boolean(item));
}

function extractTagNames(payload: JsonRecord) {
  return collectStringListDeep(payload, [
    "tags",
    "tag",
    "tag_name",
    "tag_names",
    "activecampaign_tags",
    "activecampaign_tag_ids",
    "active_campaign_tags",
    "active_campaign_tag_ids",
    "ac_tags",
  ]);
}

function extractTagAliases(payload: JsonRecord, source?: WebhookSource | null) {
  return uniqueStrings([
    ...collectStringListDeep(payload, [
      "tag_aliases",
      "tag_alias",
      "state",
      "states",
      "status",
      "campaign_name",
      "campaign_id",
      "group_name",
      "group_id",
    ]),
    findStringDeep(payload, ["event_type", "event", "source", "platform", "trigger_name"]),
    source,
  ]);
}

function extractUchatSubscriberTags(payload: JsonRecord) {
  return uniqueStrings([
    ...collectStringListDeep(payload, [
      "tags",
      "tag",
      "tag_name",
      "tag_names",
      "user_tags",
      "labels",
      "subscriber_tags",
    ]),
    ...collectStringListDeep(payload, ["state", "states", "status"]),
  ]);
}

function resolveImplicitTypebotFieldId(fieldKey: string) {
  const normalized = normalizeKey(fieldKey);

  if (normalized === "utmsource") return DEFAULT_TYPEBOT_UTM_FIELD_IDS.utm_source;
  if (normalized === "utmmedium") return DEFAULT_TYPEBOT_UTM_FIELD_IDS.utm_medium;
  if (normalized === "utmcontent") return DEFAULT_TYPEBOT_UTM_FIELD_IDS.utm_content;
  if (normalized === "utmcampaign") return DEFAULT_TYPEBOT_UTM_FIELD_IDS.utm_campaign;
  if (normalized === "utmterm") return DEFAULT_TYPEBOT_UTM_FIELD_IDS.utm_term;
  if (normalized === "utmsite") return DEFAULT_TYPEBOT_UTM_FIELD_IDS.utm_site;

  return null;
}

function resolveActiveCampaignFieldId(source: WebhookSource, fieldKey: unknown) {
  const normalizedFieldKey =
    typeof fieldKey === "number" ? String(fieldKey) : nonEmptyString(fieldKey);

  if (!normalizedFieldKey) return null;
  if (/^\d+$/.test(normalizedFieldKey)) return normalizedFieldKey;

  if (source === "typebot" || source === "tally") {
    return resolveImplicitTypebotFieldId(normalizedFieldKey);
  }

  return null;
}

function applyDefaultManyChatFieldValues(resolvedValues: Map<string, string>, payload: JsonRecord) {
  for (const [fieldId, value] of Object.entries(DEFAULT_MANYCHAT_ACTIVECAMPAIGN_FIELD_VALUES)) {
    resolvedValues.set(fieldId, value);
  }

  const qualAut = findStringDeep(payload, ["qual_aut", "qualaut"]);
  if (qualAut) {
    resolvedValues.set("25", qualAut);
  }
}

function extractActiveCampaignFieldValues(source: WebhookSource, payload: JsonRecord) {
  const resolvedValues = new Map<string, string>();

  const rememberFieldValue = (fieldKey: unknown, rawValue: unknown) => {
    const fieldId = resolveActiveCampaignFieldId(source, fieldKey);
    const value =
      typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean"
        ? String(rawValue).trim()
        : null;

    if (!fieldId || !value) return;
    resolvedValues.set(fieldId, value);
  };

  if (source === "typebot" || source === "tally") {
    for (const [payloadKey, fieldId] of Object.entries(DEFAULT_TYPEBOT_UTM_FIELD_IDS)) {
      const value = findStringDeep(payload, [payloadKey]);
      if (value) {
        resolvedValues.set(fieldId, value);
      }
    }
  }

  if (source === "manychat") {
    applyDefaultManyChatFieldValues(resolvedValues, payload);
  }

  const explicitFieldEntries = collectValuesDeep(payload, [
    "activecampaign_field_values",
    "activecampaign_fields",
    "active_campaign_field_values",
    "active_campaign_fields",
  ]);

  explicitFieldEntries.forEach((entry) => {
    if (!isRecord(entry)) return;

    const explicitFieldId =
      entry.field ??
      entry.field_id ??
      entry.fieldId ??
      entry.id ??
      entry.key;
    const explicitValue =
      entry.value ??
      entry.field_value ??
      entry.fieldValue;

    if (explicitFieldId !== undefined && explicitValue !== undefined) {
      rememberFieldValue(explicitFieldId, explicitValue);
      return;
    }

    Object.entries(entry).forEach(([key, value]) => rememberFieldValue(key, value));
  });

  return [...resolvedValues.entries()].map(([fieldId, value]) => ({ fieldId, value }));
}

function resolveActiveCampaignTags(
  source: WebhookSource,
  payload: JsonRecord,
  namedTags: NamedTag[],
) {
  const directTags = extractTagNames(payload);
  const aliases = extractTagAliases(payload, source).map(normalizeKey);
  const mappedTags = namedTags
    .filter((item) => aliases.includes(normalizeKey(item.alias)))
    .map((item) => item.tag);
  const fallbackTags =
    directTags.length === 0 && mappedTags.length === 0
      ? source === "typebot"
        ? [...DEFAULT_TYPEBOT_ACTIVECAMPAIGN_TAG_IDS]
        : source === "manychat"
          ? [...DEFAULT_MANYCHAT_ACTIVECAMPAIGN_TAG_IDS]
          : []
      : [];

  return uniqueStrings([...directTags, ...mappedTags, ...fallbackTags]);
}

function extractObservedJourneyTags(source: WebhookSource, payload: JsonRecord) {
  const tags = uniqueStrings([
    ...extractTagNames(payload),
    ...(source === "uchat" ? extractUchatSubscriberTags(payload) : []),
  ]);

  const aliases = uniqueStrings(extractTagAliases(payload, source));

  return {
    tags,
    aliases,
  };
}

async function updateLeadJourneyData(
  supabase: AnySupabaseClient,
  contact: LeadContactRow,
  source: WebhookSource,
  payload: JsonRecord,
  extra?: {
    tags?: string[];
    aliases?: string[];
  },
) {
  const data = isRecord(contact.data) ? { ...contact.data } : {};
  const currentJourney = isRecord(data.journey) ? { ...data.journey } : {};
  const currentSourceJourney =
    isRecord(currentJourney.by_source) && isRecord(currentJourney.by_source[source])
      ? { ...(currentJourney.by_source[source] as JsonRecord) }
      : {};
  const observed = extractObservedJourneyTags(source, payload);
  const nextTags = uniqueStrings([
    ...(Array.isArray(currentJourney.observed_tags) ? (currentJourney.observed_tags as string[]) : []),
    ...observed.tags,
    ...(extra?.tags ?? []),
  ]);
  const nextAliases = uniqueStrings([
    ...(Array.isArray(currentJourney.observed_aliases) ? (currentJourney.observed_aliases as string[]) : []),
    ...observed.aliases,
    ...(extra?.aliases ?? []),
  ]);
  const nextSources = uniqueStrings([
    ...(Array.isArray(data.sources) ? (data.sources as string[]) : []),
    source,
  ]);

  const nextData = {
    ...data,
    sources: nextSources,
    journey: {
      ...currentJourney,
      observed_tags: nextTags,
      observed_aliases: nextAliases,
      last_event_type:
        findStringDeep(payload, ["event_type", "event", "type", "trigger_name"]) || null,
      last_seen_at: new Date().toISOString(),
      by_source: {
        ...(isRecord(currentJourney.by_source) ? currentJourney.by_source : {}),
        [source]: {
          ...currentSourceJourney,
          observed_tags: uniqueStrings([
            ...(Array.isArray(currentSourceJourney.observed_tags)
              ? (currentSourceJourney.observed_tags as string[])
              : []),
            ...observed.tags,
            ...(extra?.tags ?? []),
          ]),
          observed_aliases: uniqueStrings([
            ...(Array.isArray(currentSourceJourney.observed_aliases)
              ? (currentSourceJourney.observed_aliases as string[])
              : []),
            ...observed.aliases,
            ...(extra?.aliases ?? []),
          ]),
          latest_payload: payload,
          updated_at: new Date().toISOString(),
        },
      },
    },
  } satisfies JsonRecord;

  await supabase
    .from("lead_contacts")
    .update({ data: nextData } as Record<string, unknown>)
    .eq("id", contact.id);
}

async function appendActiveCampaignWebhookToGoogleSheets(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  contact: LeadContactRow,
  payload: JsonRecord,
  eventId: string | null,
) {
  const config = parseGoogleSheetsConfig({
    enabled: launch.gs_enabled,
    authMode: launch.gs_auth_mode,
    serviceAccountEmail: launch.gs_service_account_email,
    privateKey: launch.gs_private_key,
    oauthRefreshToken: launch.gs_oauth_refresh_token,
    spreadsheetId: launch.gs_spreadsheet_id,
    sheetName: launch.gs_sheet_name,
  });

  if (!config) {
    return { skipped: true, reason: "google_sheets_not_configured" } as const;
  }

  const { header, row, metadata } = buildActiveCampaignSheetsRow(launch, contact, payload);

  const result = await appendGoogleSheetsRow(config, header, row);

  await insertProcessingLog(
    supabase,
    launch.id,
    contact.id,
    eventId,
    "activecampaign",
    result.skipped ? "info" : "success",
    result.skipped ? "GOOGLE_SHEETS_SKIPPED" : "GOOGLE_SHEETS_APPENDED",
    result.skipped ? "Google Sheets nao configurado" : "Contato enviado ao Google Sheets",
    result.skipped
      ? "O webhook do ActiveCampaign foi tratado, mas a captura complementar no Google Sheets nao estava configurada para este expert."
      : "O webhook do ActiveCampaign foi registrado automaticamente na planilha configurada do expert.",
    result.skipped
      ? { reason: result.reason }
      : {
          spreadsheetId: result.spreadsheetId,
          sheetName: result.sheetName,
          columns: header,
          ...metadata,
        },
  );

  return result;
}

async function fetchLaunch(
  supabase: AnySupabaseClient,
  launchId: string | null,
  launchSlug: string | null,
) {
  const query = launchId
    ? supabase
        .from("launches")
        .select("id, slug, name, webhook_secret, ac_api_url, ac_api_key, ac_default_list_id, ac_named_tags, current_cycle_number, gs_enabled, gs_auth_mode, gs_oauth_email, gs_oauth_refresh_token, gs_service_account_email, gs_private_key, gs_spreadsheet_id, gs_spreadsheet_title, gs_sheet_name")
        .eq("id", launchId)
    : supabase
        .from("launches")
        .select("id, slug, name, webhook_secret, ac_api_url, ac_api_key, ac_default_list_id, ac_named_tags, current_cycle_number, gs_enabled, gs_auth_mode, gs_oauth_email, gs_oauth_refresh_token, gs_service_account_email, gs_private_key, gs_spreadsheet_id, gs_spreadsheet_title, gs_sheet_name")
        .eq("slug", launchSlug as string);

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    throw new ProcessContactError("Expert not found", 404, error?.message);
  }

  return data as LaunchRow;
}

async function fetchLaunchWorkspaces(
  supabase: AnySupabaseClient,
  launchId: string,
) {
  const { data, error } = await supabase
    .from("uchat_workspaces")
    .select("id, workspace_name, workspace_id, api_token, welcome_subflow_ns, default_tag_name")
    .eq("launch_id", launchId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new ProcessContactError("Failed to load UChat workspaces", 500, error.message);
  }

  return (data || []) as UChatWorkspaceRow[];
}

async function fetchLeadContact(
  supabase: AnySupabaseClient,
  contactId: string,
) {
  const { data, error } = await supabase
    .from("lead_contacts")
    .select("id, primary_name, primary_email, primary_phone, normalized_phone, data")
    .eq("id", contactId)
    .maybeSingle();

  if (error || !data) {
    throw new ProcessContactError("Canonical contact not found after processing", 500, error?.message);
  }

  return data as LeadContactRow;
}

async function fetchLeadIdentity(
  supabase: AnySupabaseClient,
  launchId: string,
  contactId: string,
  source: string,
) {
  const { data } = await supabase
    .from("lead_contact_identities")
    .select("id, external_contact_id, raw_snapshot")
    .eq("launch_id", launchId)
    .eq("contact_id", contactId)
    .eq("source", source)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as { id: string; external_contact_id: string | null; raw_snapshot: unknown } | null;
}

async function upsertLeadIdentity(
  supabase: AnySupabaseClient,
  launchId: string,
  contactId: string,
  source: string,
  externalContactId: string,
  email: string | null,
  phone: string | null,
  rawSnapshot: JsonRecord,
) {
  const { data: existing } = await supabase
    .from("lead_contact_identities")
    .select("id")
    .eq("launch_id", launchId)
    .eq("source", source)
    .eq("external_contact_id", externalContactId)
    .maybeSingle();
  const existingIdentity = existing as { id?: string } | null;

  if (existingIdentity?.id) {
    await supabase
      .from("lead_contact_identities")
      .update({
        contact_id: contactId,
        external_email: email,
        external_phone: phone,
        normalized_phone: phone,
        raw_snapshot: rawSnapshot,
      } as Record<string, unknown>)
      .eq("id", existingIdentity.id);
    return;
  }

  await supabase.from("lead_contact_identities").insert({
    launch_id: launchId,
    contact_id: contactId,
    source,
    external_contact_id: externalContactId,
    external_email: email,
    external_phone: phone,
    normalized_phone: phone,
    raw_snapshot: rawSnapshot,
  } as Record<string, unknown>);
}

async function insertProcessingLog(
  supabase: AnySupabaseClient,
  launchId: string,
  contactId: string | null,
  eventId: string | null,
  source: string,
  level: "info" | "warning" | "error" | "success",
  code: string,
  title: string,
  message: string,
  details: JsonRecord = {},
) {
  await supabase.from("contact_processing_logs").insert({
    launch_id: launchId,
    contact_id: contactId,
    event_id: eventId,
    source,
    level,
    code,
    title,
    message,
    details,
  } as Record<string, unknown>);
}

async function createRoutingAction(
  supabase: AnySupabaseClient,
  launchId: string,
  contactId: string,
  eventId: string,
  source: string,
  target: string,
  actionType: string,
  actionKey: string | null,
  requestPayload: JsonRecord,
) {
  const { data, error } = await supabase
    .from("contact_routing_actions")
    .insert({
      launch_id: launchId,
      contact_id: contactId,
      event_id: eventId,
      source,
      target,
      action_type: actionType,
      action_key: actionKey,
      request_payload: requestPayload,
      status: "pending",
    } as Record<string, unknown>)
    .select("id")
    .single();

  if (error?.code === "23505") {
    return null;
  }

  if (error || !data) {
    throw new ProcessContactError("Failed to create routing action", 500, error?.message);
  }

  return (data as RoutingActionRow).id;
}

async function updateRoutingAction(
  supabase: AnySupabaseClient,
  actionId: string,
  status: "success" | "failed" | "skipped",
  responsePayload: JsonRecord,
  errorMessage?: string | null,
) {
  await supabase
    .from("contact_routing_actions")
    .update({
      status,
      response_payload: responsePayload,
      error_message: errorMessage || null,
    } as Record<string, unknown>)
    .eq("id", actionId);
}

function isFreshPendingRoutingAction(action: RoutingActionRow) {
  if (action.status !== "pending" || !action.created_at) {
    return false;
  }

  const createdAtMs = Date.parse(action.created_at);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }

  return Date.now() - createdAtMs < ROUTING_PENDING_TIMEOUT_MS;
}

async function findBlockingRoutingAction(
  supabase: AnySupabaseClient,
  launchId: string,
  contactId: string,
  source: string,
  target: string,
  actionType: string,
  actionKey: string | null,
) {
  const query = supabase
    .from("contact_routing_actions")
    .select("id, status, created_at")
    .eq("launch_id", launchId)
    .eq("contact_id", contactId)
    .eq("source", source)
    .eq("target", target)
    .eq("action_type", actionType)
    .in("status", ["pending", "success"])
    .order("created_at", { ascending: false });

  const { data } = actionKey
    ? await query.eq("action_key", actionKey).limit(1).maybeSingle()
    : await query.is("action_key", null).limit(1).maybeSingle();

  return data ? (data as RoutingActionRow) : null;
}

async function claimRoutingAction(
  supabase: AnySupabaseClient,
  launchId: string,
  contactId: string,
  eventId: string,
  source: string,
  target: string,
  actionType: string,
  actionKey: string | null,
  requestPayload: JsonRecord,
) {
  if (actionKey) {
    const existingAction = await findBlockingRoutingAction(
      supabase,
      launchId,
      contactId,
      source,
      target,
      actionType,
      actionKey,
    );

    if (existingAction?.status === "success") {
      return null;
    }

    if (existingAction?.status === "pending") {
      if (isFreshPendingRoutingAction(existingAction)) {
        return null;
      }

      await updateRoutingAction(
        supabase,
        existingAction.id,
        "failed",
        {
          reason: "stale_pending_lock_released",
          releasedAt: new Date().toISOString(),
        },
        "Released stale routing action lock before retry",
      );
    }
  }

  return await createRoutingAction(
    supabase,
    launchId,
    contactId,
    eventId,
    source,
    target,
    actionType,
    actionKey,
    requestPayload,
  );
}

async function loadAllActiveCampaignTags(apiUrl: string, apiKey: string) {
  const cacheKey = `${normalizeActiveCampaignBaseUrl(apiUrl)}::${apiKey}`;
  const cachedTags = activeCampaignTagCache.get(cacheKey);
  if (cachedTags) {
    return cachedTags;
  }

  const tags: Array<{ id: string; tag: string }> = [];
  let offset = 0;

  while (true) {
    const payload = await activeCampaignRequest(apiUrl, apiKey, "/api/3/tags", "GET", undefined, {
      limit: 100,
      offset,
    });

    const batch = Array.isArray((payload as JsonRecord).tags)
      ? ((payload as JsonRecord).tags as JsonRecord[])
      : [];

    if (batch.length === 0) break;

    batch.forEach((item) => {
      const id = nonEmptyString(item.id);
      const tag = nonEmptyString(item.tag);
      if (id && tag) tags.push({ id, tag });
    });

    offset += batch.length;
    if (batch.length < 100) break;
  }

  activeCampaignTagCache.set(cacheKey, tags);
  return tags;
}

async function resolveActiveCampaignTagId(
  launch: LaunchRow,
  tagLabel: string,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) {
    throw new ProcessContactError("ActiveCampaign is not configured for this expert", 400);
  }

  if (/^\d+$/.test(tagLabel)) {
    return tagLabel;
  }

  const existingTags = await loadAllActiveCampaignTags(launch.ac_api_url, launch.ac_api_key);
  const match = existingTags.find((item) => normalizeKey(item.tag) === normalizeKey(tagLabel));

  if (match?.id) return match.id;

  const payload = await activeCampaignRequest(
    launch.ac_api_url,
    launch.ac_api_key,
    "/api/3/tags",
    "POST",
    {
      tag: {
        tag: tagLabel,
        tagType: "contact",
        description: `Launch Hub auto-created tag for ${launch.name}`,
      },
    },
  );

  const createdTag = isRecord((payload as JsonRecord).tag) ? ((payload as JsonRecord).tag as JsonRecord) : {};
  const createdId = nonEmptyString(createdTag.id);

  if (!createdId) {
    throw new ProcessContactError("Failed to create ActiveCampaign tag", 500);
  }

  const cacheKey = `${normalizeActiveCampaignBaseUrl(launch.ac_api_url)}::${launch.ac_api_key}`;
  const cachedTags = activeCampaignTagCache.get(cacheKey) || [];
  activeCampaignTagCache.set(cacheKey, [...cachedTags, { id: createdId, tag: tagLabel }]);

  return createdId;
}

async function syncContactToActiveCampaign(
  launch: LaunchRow,
  contact: LeadContactRow,
  tagNames: string[],
  fieldValues: ActiveCampaignFieldValueInput[],
  knownContactId?: string | null,
  options?: { phoneOnlyMatch?: boolean; phoneSearchValue?: string | null },
) {
  if (!launch.ac_api_url || !launch.ac_api_key) {
    throw new ProcessContactError("ActiveCampaign is not configured for this expert", 400);
  }

  if (!contact.primary_email && !contact.primary_phone) {
    throw new ProcessContactError("The contact does not have email or phone to send to ActiveCampaign", 400);
  }

  const phoneOnly = options?.phoneOnlyMatch === true;
  const overridePhone = nonEmptyString(options?.phoneSearchValue) || null;

  const { firstName, lastName } = splitName(contact.primary_name);
  // For Sendflow (phoneOnly), never overwrite the email of the existing AC contact;
  // we only want to merge/update by phone and apply the configured tag.
  const contactPayload = {
    email: phoneOnly ? undefined : (contact.primary_email || undefined),
    phone: overridePhone || contact.primary_phone || undefined,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
  };
  const existingContact = await findExistingActiveCampaignContact(
    launch,
    contact,
    knownContactId,
    { phoneOnly, phoneSearchValue: overridePhone },
  );
  if (!existingContact && phoneOnly && !contact.primary_email) {
    // Sendflow phone-only path: only update/merge an EXISTING ActiveCampaign contact.
    // We never create a new contact from a Sendflow webhook that carries no email.
    throw new ProcessContactError(
      "ActiveCampaign contact not found by phone for Sendflow webhook",
      404,
    );
  }

  const payload = existingContact
    ? await activeCampaignRequest(
        launch.ac_api_url,
        launch.ac_api_key,
        `/api/3/contacts/${existingContact.activeContactId}`,
        "PUT",
        {
          contact: contactPayload,
        },
      )
    : await activeCampaignRequest(
        launch.ac_api_url,
        launch.ac_api_key,
        "/api/3/contact/sync",
        "POST",
        {
          contact: contactPayload,
        },
      );

  const syncedContact = isRecord((payload as JsonRecord).contact) ? ((payload as JsonRecord).contact as JsonRecord) : {};
  const activeContactId = nonEmptyString(syncedContact.id) || existingContact?.activeContactId;

  if (!activeContactId) {
    throw new ProcessContactError("ActiveCampaign did not return the synced contact id", 500);
  }

  const appliedFieldValues = await upsertActiveCampaignFieldValues(
    launch,
    activeContactId,
    fieldValues,
  );

  if (launch.ac_default_list_id) {
    try {
      await activeCampaignRequest(
        launch.ac_api_url,
        launch.ac_api_key,
        "/api/3/contactLists",
        "POST",
        {
          contactList: {
            list: launch.ac_default_list_id,
            contact: activeContactId,
            status: 1,
          },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/\b(already|duplicate|exists|duplicado|existe)\b/i.test(message)) {
        throw error;
      }
    }
  }

  const appliedTags: string[] = [];
  const existingTagIds = new Set(await listActiveCampaignContactTagIds(launch, activeContactId));
  for (const tagName of uniqueStrings(tagNames)) {
    const tagId = await resolveActiveCampaignTagId(launch, tagName);
    if (existingTagIds.has(tagId)) {
      appliedTags.push(tagName);
      continue;
    }

    try {
      await activeCampaignRequest(
        launch.ac_api_url,
        launch.ac_api_key,
        "/api/3/contactTags",
        "POST",
        {
          contactTag: {
            contact: activeContactId,
            tag: tagId,
          },
        },
      );
      existingTagIds.add(tagId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/\b(already|duplicate|exists|duplicado|existe)\b/i.test(message)) {
        throw error;
      }
    }
    appliedTags.push(tagName);
  }

  return {
    activeContactId,
    appliedTags,
    appliedFieldValues,
    matchedBy: existingContact?.matchedBy || null,
    operation: existingContact ? "updated_existing" : "synced",
  };
}

async function listActiveCampaignContactFieldValues(
  launch: LaunchRow,
  activeContactId: string,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) return [];

  const payload = await activeCampaignRequest(
    launch.ac_api_url,
    launch.ac_api_key,
    `/api/3/contacts/${activeContactId}/fieldValues`,
    "GET",
  );

  const fieldValues = Array.isArray((payload as JsonRecord).fieldValues)
    ? ((payload as JsonRecord).fieldValues as unknown[])
    : [];

  return fieldValues
    .map((item) => {
      if (!isRecord(item)) return null;

      const id = nonEmptyString(item.id);
      const fieldId = nonEmptyString(item.field);
      const value =
        typeof item.value === "string" || typeof item.value === "number" || typeof item.value === "boolean"
          ? String(item.value).trim()
          : "";

      if (!fieldId) return null;
      return { id, fieldId, value };
    })
    .filter((item): item is { id: string | null; fieldId: string; value: string } => Boolean(item));
}

async function upsertActiveCampaignFieldValues(
  launch: LaunchRow,
  activeContactId: string,
  fieldValues: ActiveCampaignFieldValueInput[],
) {
  if (!launch.ac_api_url || !launch.ac_api_key || fieldValues.length === 0) {
    return [] as Array<{ fieldId: string; value: string; operation: string }>;
  }

  const existingFieldValues = await listActiveCampaignContactFieldValues(launch, activeContactId);
  const appliedFieldValues: Array<{ fieldId: string; value: string; operation: string }> = [];

  for (const fieldValue of fieldValues) {
    const existingFieldValue = existingFieldValues.find((item) => item.fieldId === fieldValue.fieldId);

    if (existingFieldValue?.value === fieldValue.value) {
      appliedFieldValues.push({
        fieldId: fieldValue.fieldId,
        value: fieldValue.value,
        operation: "unchanged",
      });
      continue;
    }

    const path = existingFieldValue?.id
      ? `/api/3/fieldValues/${existingFieldValue.id}`
      : "/api/3/fieldValues";
    const method = existingFieldValue?.id ? "PUT" : "POST";

    await activeCampaignRequest(
      launch.ac_api_url,
      launch.ac_api_key,
      path,
      method,
      {
        fieldValue: {
          contact: activeContactId,
          field: fieldValue.fieldId,
          value: fieldValue.value,
        },
      },
    );

    appliedFieldValues.push({
      fieldId: fieldValue.fieldId,
      value: fieldValue.value,
      operation: existingFieldValue?.id ? "updated" : "created",
    });
  }

  return appliedFieldValues;
}

async function listActiveCampaignContactTagIds(
  launch: LaunchRow,
  activeContactId: string,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) return [] as string[];

  let payload: unknown;
  try {
    payload = await activeCampaignRequest(
      launch.ac_api_url,
      launch.ac_api_key,
      `/api/3/contacts/${activeContactId}/contactTags`,
      "GET",
    );
  } catch {
    return [] as string[];
  }

  const contactTags = Array.isArray((payload as JsonRecord).contactTags)
    ? ((payload as JsonRecord).contactTags as JsonRecord[])
    : [];

  return uniqueStrings(
    contactTags
      .map((item) => nonEmptyString(item.tag))
      .filter((tagId): tagId is string => Boolean(tagId)),
  );
}

function extractActiveCampaignContact(payload: unknown) {
  if (!isRecord(payload)) return null;

  if (isRecord((payload as JsonRecord).contact)) {
    return ((payload as JsonRecord).contact as JsonRecord) || null;
  }

  const contacts = Array.isArray((payload as JsonRecord).contacts)
    ? ((payload as JsonRecord).contacts as JsonRecord[])
    : [];

  return contacts[0] || null;
}

function extractActiveCampaignContacts(payload: unknown) {
  if (!isRecord(payload)) return [] as JsonRecord[];

  if (isRecord((payload as JsonRecord).contact)) {
    return [(payload as JsonRecord).contact as JsonRecord];
  }

  return Array.isArray((payload as JsonRecord).contacts)
    ? ((payload as JsonRecord).contacts as JsonRecord[]).filter(isRecord)
    : [];
}

function pickActiveCampaignContactByPhone(
  payload: unknown,
  phoneCandidates: string[],
) {
  const contacts = extractActiveCampaignContacts(payload);

  return (
    contacts.find((candidate) =>
      phoneCandidates.some((phoneCandidate) =>
        phonesLookEquivalent(candidate.phone, phoneCandidate)
      )
    ) ||
    contacts[0] ||
    null
  );
}

async function findExistingActiveCampaignContact(
  launch: LaunchRow,
  contact: LeadContactRow,
  knownContactId?: string | null,
  options?: { phoneOnly?: boolean; phoneSearchValue?: string | null },
) {
  if (!launch.ac_api_url || !launch.ac_api_key) {
    return null;
  }

  const phoneOnly = options?.phoneOnly === true;

  if (knownContactId && !phoneOnly) {
    try {
      const payload = await activeCampaignRequest(
        launch.ac_api_url,
        launch.ac_api_key,
        `/api/3/contacts/${knownContactId}`,
        "GET",
      );

      const matchedContact = extractActiveCampaignContact(payload);
      const activeContactId = nonEmptyString(matchedContact?.id);
      if (matchedContact && activeContactId) {
        return {
          matchedBy: "known-id",
          activeContactId,
          snapshot: matchedContact,
        };
      }
    } catch {
      // Fall back to fresh lookup if the stored identity is stale.
    }
  }

  if (!phoneOnly && contact.primary_email) {
    const payload = await activeCampaignRequest(
      launch.ac_api_url,
      launch.ac_api_key,
      "/api/3/contacts",
      "GET",
      undefined,
      { email: contact.primary_email },
    );

    const matchedContact = extractActiveCampaignContact(payload);
    const activeContactId = nonEmptyString(matchedContact?.id);
    if (matchedContact && activeContactId) {
      return {
        matchedBy: "email",
        activeContactId,
        snapshot: matchedContact,
      };
    }
  }

  const phoneCandidates = buildPhoneSearchCandidates([
    options?.phoneSearchValue,
    contact.primary_phone,
    contact.normalized_phone,
  ]);

  for (const phoneCandidate of phoneCandidates) {
    const queryVariants = [
      { phone: phoneCandidate },
      { "filters[phone]": phoneCandidate },
      { search: phoneCandidate },
    ];

    for (const query of queryVariants) {
      const payload = await activeCampaignRequest(
        launch.ac_api_url,
        launch.ac_api_key,
        "/api/3/contacts",
        "GET",
        undefined,
        query,
      );

      const matchedContact = pickActiveCampaignContactByPhone(payload, phoneCandidates);
      const activeContactId = nonEmptyString(matchedContact?.id);
      if (matchedContact && activeContactId) {
        return {
          matchedBy: "phone",
          activeContactId,
          snapshot: matchedContact,
        };
      }
    }
  }

  return null;
}

async function verifyContactAgainstActiveCampaign(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  contact: LeadContactRow,
  eventId: string,
  source: WebhookSource,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) {
    return {
      target: "activecampaign",
      skipped: true,
      reason: "not_configured",
    };
  }

  if (!contact.primary_email && !contact.primary_phone && !contact.normalized_phone) {
    return {
      target: "activecampaign",
      skipped: true,
      reason: "missing_contact_data",
    };
  }

  const existingIdentity = await fetchLeadIdentity(supabase, launch.id, contact.id, "activecampaign");
  const knownContactId = nonEmptyString(existingIdentity?.external_contact_id);
  const phoneCandidates = uniqueStrings([
    contact.primary_phone,
    contact.normalized_phone,
    contact.primary_phone?.replace(/\D/g, "") || null,
  ]);
  const actionKey = JSON.stringify({
    knownContactId,
    email: contact.primary_email,
    phoneCandidates,
  });

  const actionId = await claimRoutingAction(
    supabase,
    launch.id,
    contact.id,
    eventId,
    source,
    "activecampaign",
    "verify-contact",
    actionKey,
    {
      knownContactId,
      email: contact.primary_email,
      phoneCandidates,
    },
  );

  if (!actionId) {
    return {
      target: "activecampaign",
      skipped: true,
      reason: "verify_already_in_progress",
    };
  }

  try {
    const matched = await findExistingActiveCampaignContact(
      launch,
      contact,
      knownContactId,
    );

    if (!matched) {
      const response = {
        matched: false,
        activeContactId: null,
      } satisfies JsonRecord;
      await updateRoutingAction(supabase, actionId, "success", response);

      return {
        target: "activecampaign",
        matched: false,
      };
    }

    await upsertLeadIdentity(
      supabase,
      launch.id,
      contact.id,
      "activecampaign",
      matched.activeContactId,
      nonEmptyString(matched.snapshot.email) || contact.primary_email,
      nonEmptyString(matched.snapshot.phone) || contact.primary_phone,
      matched.snapshot,
    );

    const response = {
      matched: true,
      activeContactId: matched.activeContactId,
      matchedBy: matched.matchedBy,
    } satisfies JsonRecord;

    await updateRoutingAction(supabase, actionId, "success", response);

    return {
      target: "activecampaign",
      matched: true,
      activeContactId: matched.activeContactId,
      matchedBy: matched.matchedBy,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateRoutingAction(supabase, actionId, "failed", {}, message);
    throw error;
  }
}

function pickPreferredWorkspace(
  workspaces: UChatWorkspaceRow[],
  payload: JsonRecord,
) {
  const requestedWorkspaceId =
    findStringDeep(payload, ["workspace_id", "workspaceId", "uchat_workspace_id", "bot_id", "project_id"]) ||
    findStringDeep(payload, ["workspace"]) ||
    null;

  if (requestedWorkspaceId) {
    const match = workspaces.find((workspace) =>
      [workspace.id, workspace.workspace_id].filter(Boolean).includes(requestedWorkspaceId)
    );
    if (match) return match;
  }

  return workspaces.find((workspace) => nonEmptyString(workspace.api_token)) || null;
}

function pickFirstSubscriberRow(payload: unknown) {
  if (Array.isArray((payload as JsonRecord)?.data)) {
    return (((payload as JsonRecord).data as JsonRecord[])[0] || null) as JsonRecord | null;
  }

  if (isRecord((payload as JsonRecord)?.subscriber)) {
    return ((payload as JsonRecord).subscriber as JsonRecord) || null;
  }

  if (isRecord(payload)) {
    return payload;
  }

  return null;
}

async function fetchUchatSubscriberByQuery(
  workspace: UChatWorkspaceRow,
  query: Record<string, string | number | undefined>,
) {
  const response = await uchatRequest(workspace.api_token, "/subscribers", "GET", undefined, {
    limit: 1,
    page: 1,
    ...query,
  });

  return pickFirstSubscriberRow(response);
}

async function fetchUchatSubscriberByUserId(
  workspace: UChatWorkspaceRow,
  userId: string,
) {
  const response = await uchatRequest(
    workspace.api_token,
    "/subscriber/get-info-by-user-id",
    "GET",
    undefined,
    { user_id: userId },
  );

  return pickFirstSubscriberRow(response);
}

async function createUchatSubscriberFromExplicitPayload(
  workspace: UChatWorkspaceRow,
  payload: JsonRecord,
  phoneOverride?: string | null,
) {
  const explicitContact = extractGenericContact(payload);
  const normalizedPhone = phoneOverride || pickPreferredUchatCreatePhone(explicitContact.phone);

  if (!normalizedPhone && !explicitContact.email) {
    throw new ProcessContactError(
      "Relay webhook requires explicit valid phone or email to create the UChat subscriber precisely",
      400,
    );
  }

  const { firstName, lastName } = splitName(explicitContact.name);
  const created = await uchatRequest(workspace.api_token, "/subscriber/create", "POST", {
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    name: explicitContact.name || undefined,
    phone: normalizedPhone || undefined,
    email: explicitContact.email || undefined,
  });

  const createdRecord = isRecord(created) ? (created as JsonRecord) : null;
  const createdUserNs =
    findStringDeep(createdRecord, ["user_ns"]) ||
    findStringDeep(createdRecord, ["subscriber.user_ns"]) ||
    null;

  if (!createdUserNs) {
    throw new ProcessContactError("UChat did not return user_ns after explicit subscriber creation", 500);
  }

  return {
    userNs: createdUserNs,
    userId: extractKnownUchatUserId(createdRecord),
    snapshot: createdRecord,
    resolutionSource: "payload_create",
  } satisfies ResolvedUchatRecipient;
}

async function resolveExplicitUchatRecipient(
  workspace: UChatWorkspaceRow,
  payload: JsonRecord,
) {
  const payloadUserNs = extractUchatUserNs(payload);
  if (payloadUserNs) {
    return {
      userNs: payloadUserNs,
      userId: extractUchatUserId(payload) || extractKnownUchatUserId(payload),
      snapshot: isRecord(payload) ? payload : null,
      resolutionSource: "payload_user_ns",
    } satisfies ResolvedUchatRecipient;
  }

  const payloadUserId = extractUchatUserId(payload);
  if (payloadUserId) {
    const subscriberByUserId = await fetchUchatSubscriberByUserId(workspace, payloadUserId);
    const userNs = nonEmptyString(subscriberByUserId?.user_ns);
    if (!subscriberByUserId || !userNs) {
      throw new ProcessContactError(
        "Explicit UChat user_id from payload was not found in the configured workspace",
        400,
      );
    }

    return {
      userNs,
      userId: extractKnownUchatUserId(subscriberByUserId) || payloadUserId,
      snapshot: subscriberByUserId,
      resolutionSource: "payload_user_id",
    } satisfies ResolvedUchatRecipient;
  }

  const explicitContact = extractGenericContact(payload);

  if (explicitContact.phone) {
    const phoneCandidates = buildUchatPhoneCandidates(explicitContact.phone);

    for (const phoneCandidate of phoneCandidates) {
      const phoneMatch = await fetchUchatSubscriberByQuery(workspace, {
        phone: phoneCandidate,
      });
      const userNs = nonEmptyString(phoneMatch?.user_ns);
      if (phoneMatch && userNs) {
        return {
          userNs,
          userId: extractKnownUchatUserId(phoneMatch),
          snapshot: phoneMatch,
          resolutionSource: "payload_phone",
        } satisfies ResolvedUchatRecipient;
      }
    }
  }

  if (explicitContact.email) {
    const emailMatch = await fetchUchatSubscriberByQuery(workspace, {
      email: explicitContact.email,
    });
    const userNs = nonEmptyString(emailMatch?.user_ns);
    if (emailMatch && userNs) {
      return {
        userNs,
        userId: extractKnownUchatUserId(emailMatch),
        snapshot: emailMatch,
        resolutionSource: "payload_email",
      } satisfies ResolvedUchatRecipient;
    }
  }

  const createPhone = pickPreferredUchatCreatePhone(explicitContact.phone);
  if (createPhone || explicitContact.email) {
    return await createUchatSubscriberFromExplicitPayload(workspace, payload, createPhone);
  }

  throw new ProcessContactError(
    "Relay webhook requires explicit recipient data (user_id, user_ns, phone or email) to route precisely to UChat",
    400,
  );
}

async function findUchatSubscriberForContact(
  supabase: AnySupabaseClient,
  launchId: string,
  contact: LeadContactRow,
  payload: JsonRecord,
  workspace: UChatWorkspaceRow,
) {
  const inboundUserNs = extractUchatUserNs(payload);
  const inboundUserId = extractUchatUserId(payload);
  const existingIdentity = await fetchLeadIdentity(supabase, launchId, contact.id, "uchat");
  const existingExternalId = nonEmptyString(existingIdentity?.external_contact_id);
  const existingSnapshot = isRecord(existingIdentity?.raw_snapshot)
    ? (existingIdentity.raw_snapshot as JsonRecord)
    : null;
  const legacyStoredUserId = existingExternalId && !isLikelyUchatUserNs(existingExternalId) ? existingExternalId : null;
  const existingUserId = extractKnownUchatUserId(existingSnapshot) || legacyStoredUserId;
  const knownUserNs = inboundUserNs || (isLikelyUchatUserNs(existingExternalId) ? existingExternalId : null);

  if (knownUserNs) {
    const match = await fetchUchatSubscriberByQuery(workspace, { user_ns: knownUserNs });
    if (match) {
      return {
        userNs: knownUserNs,
        userId: extractKnownUchatUserId(match) || existingUserId,
        snapshot: match,
      };
    }

    if (existingUserId) {
      return {
        userNs: knownUserNs,
        userId: existingUserId,
        snapshot: existingSnapshot,
      };
    }
  }

  if (existingUserId) {
    const match = await fetchUchatSubscriberByUserId(workspace, existingUserId);
    const userNs = nonEmptyString(match?.user_ns);
    if (match && userNs) {
      return {
        userNs,
        userId: extractKnownUchatUserId(match) || existingUserId,
        snapshot: match,
      };
    }
  }

  if (inboundUserId) {
    const match = await fetchUchatSubscriberByUserId(workspace, inboundUserId);
    const userNs = nonEmptyString(match?.user_ns);
    if (match && userNs) {
      return {
        userNs,
        userId: extractKnownUchatUserId(match) || inboundUserId,
        snapshot: match,
      };
    }
  }

  if (contact.primary_phone) {
    const phoneMatch = await fetchUchatSubscriberByQuery(workspace, {
      phone: contact.primary_phone,
    });

    const userNs = nonEmptyString(phoneMatch?.user_ns);
    if (phoneMatch && userNs) {
      return {
        userNs,
        userId: extractKnownUchatUserId(phoneMatch),
        snapshot: phoneMatch,
      };
    }
  }

  if (contact.primary_email) {
    const emailMatch = await fetchUchatSubscriberByQuery(workspace, {
      email: contact.primary_email,
    });

    const userNs = nonEmptyString(emailMatch?.user_ns);
    if (emailMatch && userNs) {
      return {
        userNs,
        userId: extractKnownUchatUserId(emailMatch),
        snapshot: emailMatch,
      };
    }
  }

  return null;
}

async function loadUchatSubscriberState(
  supabase: AnySupabaseClient,
  launchId: string,
  contact: LeadContactRow,
  payload: JsonRecord,
) {
  const workspaces = await fetchLaunchWorkspaces(supabase, launchId);
  const workspace = pickPreferredWorkspace(workspaces, payload);

  if (!workspace) {
    return null;
  }

  const subscriber = await findUchatSubscriberForContact(
    supabase,
    launchId,
    contact,
    payload,
    workspace,
  );

  if (!subscriber) {
    return null;
  }

  const snapshot = subscriber.snapshot ?? {};

  return {
    workspace,
    userNs: subscriber.userNs,
    userId: subscriber.userId,
    snapshot,
    currentTags: extractUchatSubscriberTags(snapshot),
  } satisfies UchatSubscriberLookup;
}

function enrichPayloadWithUchatState(
  payload: JsonRecord,
  subscriberState: UchatSubscriberLookup | null,
) {
  if (!subscriberState) {
    return payload;
  }

  const mergedTags = uniqueStrings([
    ...extractTagNames(payload),
    ...subscriberState.currentTags,
  ]);
  const mergedAliases = uniqueStrings([
    ...extractTagAliases(payload),
    ...subscriberState.currentTags,
  ]);

  return {
    ...payload,
    tags: mergedTags,
    tag_names: mergedTags,
    tag_aliases: mergedAliases,
    uchat_current_tags: subscriberState.currentTags,
    uchat_workspace_id: subscriberState.workspace.workspace_id,
    uchat_user_ns: subscriberState.userNs,
    ...(subscriberState.userId ? { uchat_user_id: subscriberState.userId } : {}),
    uchat_subscriber: subscriberState.snapshot,
  } satisfies JsonRecord;
}

async function findOrCreateUchatUser(
  supabase: AnySupabaseClient,
  launchId: string,
  contact: LeadContactRow,
  workspace: UChatWorkspaceRow,
  payload?: JsonRecord,
) {
  const payloadUserNs = extractUchatUserNs(payload);
  const payloadUserId = extractUchatUserId(payload);

  if (payloadUserNs) {
    return {
      userNs: payloadUserNs,
      userId: payloadUserId || extractKnownUchatUserId(payload || null),
      snapshot: isRecord(payload) ? payload : null,
      resolutionSource: "payload_user_ns",
    } satisfies ResolvedUchatRecipient;
  }

  const existingIdentity = await fetchLeadIdentity(supabase, launchId, contact.id, "uchat");
  const existingExternalId = nonEmptyString(existingIdentity?.external_contact_id);
  const existingUserNs = isLikelyUchatUserNs(existingExternalId) ? existingExternalId : null;
  const existingSnapshot = isRecord(existingIdentity?.raw_snapshot)
    ? (existingIdentity.raw_snapshot as JsonRecord)
    : null;
  const legacyStoredUserId = existingExternalId && !isLikelyUchatUserNs(existingExternalId) ? existingExternalId : null;
  const existingUserId = extractKnownUchatUserId(existingSnapshot) || legacyStoredUserId;

    if (existingUserNs) {
      const existingSubscriber = await fetchUchatSubscriberByQuery(workspace, { user_ns: existingUserNs });
      if (existingSubscriber && nonEmptyString(existingSubscriber.user_ns)) {
        return {
          userNs: existingUserNs,
          userId: extractKnownUchatUserId(existingSubscriber) || existingUserId,
          snapshot: existingSubscriber,
          resolutionSource: "existing_identity",
        } satisfies ResolvedUchatRecipient;
      }

      if (existingUserId) {
        return {
          userNs: existingUserNs,
          userId: existingUserId,
          snapshot: existingSnapshot,
          resolutionSource: "existing_identity_fallback",
        } satisfies ResolvedUchatRecipient;
      }
    }

  if (existingUserId) {
    const subscriberByExistingUserId = await fetchUchatSubscriberByUserId(workspace, existingUserId);
    const userNs = nonEmptyString(subscriberByExistingUserId?.user_ns);
    if (userNs) {
      return {
        userNs,
        userId: extractKnownUchatUserId(subscriberByExistingUserId) || existingUserId,
        snapshot: subscriberByExistingUserId,
        resolutionSource: "existing_user_id",
      } satisfies ResolvedUchatRecipient;
    }
  }

  if (payloadUserId) {
    const subscriberByUserId = await fetchUchatSubscriberByUserId(workspace, payloadUserId);
    const userNs = nonEmptyString(subscriberByUserId?.user_ns);
    if (userNs) {
      return {
        userNs,
        userId: extractKnownUchatUserId(subscriberByUserId) || payloadUserId,
        snapshot: subscriberByUserId,
        resolutionSource: "payload_user_id",
      } satisfies ResolvedUchatRecipient;
    }
  }

  if (contact.primary_phone) {
    const phoneSearch = await uchatRequest(workspace.api_token, "/subscribers", "GET", undefined, {
      limit: 1,
      page: 1,
      phone: contact.primary_phone,
    });

    const phoneMatch = Array.isArray((phoneSearch as JsonRecord).data)
      ? (((phoneSearch as JsonRecord).data as JsonRecord[])[0] || null)
      : null;

    const userNs = nonEmptyString(phoneMatch?.user_ns);
    if (userNs) {
      return {
        userNs,
        userId: extractKnownUchatUserId(phoneMatch),
        snapshot: phoneMatch,
        resolutionSource: "phone_search",
      } satisfies ResolvedUchatRecipient;
    }
  }

  if (contact.primary_email) {
    const emailSearch = await uchatRequest(workspace.api_token, "/subscribers", "GET", undefined, {
      limit: 1,
      page: 1,
      email: contact.primary_email,
    });

    const emailMatch = Array.isArray((emailSearch as JsonRecord).data)
      ? (((emailSearch as JsonRecord).data as JsonRecord[])[0] || null)
      : null;

    const userNs = nonEmptyString(emailMatch?.user_ns);
    if (userNs) {
      return {
        userNs,
        userId: extractKnownUchatUserId(emailMatch),
        snapshot: emailMatch,
        resolutionSource: "email_search",
      } satisfies ResolvedUchatRecipient;
    }
  }

  const { firstName, lastName } = splitName(contact.primary_name);
  const created = await uchatRequest(workspace.api_token, "/subscriber/create", "POST", {
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    name: contact.primary_name || undefined,
    phone: contact.primary_phone || undefined,
    email: contact.primary_email || undefined,
  });

  const createdUserNs =
    findStringDeep(created, ["user_ns"]) ||
    findStringDeep(created, ["subscriber.user_ns"]) ||
    null;

  if (!createdUserNs) {
    throw new ProcessContactError("UChat did not return user_ns after subscriber creation", 500);
  }

  return {
    userNs: createdUserNs,
    userId: extractKnownUchatUserId(isRecord(created) ? (created as JsonRecord) : null),
    snapshot: isRecord(created) ? (created as JsonRecord) : null,
    resolutionSource: "subscriber_created",
  } satisfies ResolvedUchatRecipient;
}

async function routeToUchat(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  contact: LeadContactRow,
  eventId: string,
  source: WebhookSource,
  payload: JsonRecord,
  options: RouteToUchatOptions = {},
) {
  const workspaces = await fetchLaunchWorkspaces(supabase, launch.id);
  const workspace = pickPreferredWorkspace(workspaces, payload);

  if (!workspace) {
    throw new ProcessContactError("No valid UChat workspace configured for this expert", 400);
  }

  const recipient = options.requireExplicitRecipient
    ? await resolveExplicitUchatRecipient(workspace, payload)
    : await findOrCreateUchatUser(supabase, launch.id, contact, workspace, payload);
  const userNs = recipient.userNs;
  const targetUserId = recipient.userId || extractUchatUserId(payload);

  await upsertLeadIdentity(
    supabase,
    launch.id,
    contact.id,
    "uchat",
    userNs,
    contact.primary_email,
    contact.primary_phone,
    {
      workspace_id: workspace.workspace_id,
      workspace_name: workspace.workspace_name,
      user_ns: userNs,
      ...(targetUserId ? { user_id: targetUserId } : {}),
      resolution_source: recipient.resolutionSource,
    },
  );

  const explicitSubflowNs = findStringDeep(payload, ["subflow_ns", "subflow", "welcome_subflow_ns"]);
  const workspaceDefaultSubflowNs =
    options.allowWorkspaceDefaultSubflow === false ? null : nonEmptyString(workspace.welcome_subflow_ns);
  const subflowNs =
    options.allowSubflow === false
      ? null
      : explicitSubflowNs || workspaceDefaultSubflowNs;
  const tagName =
    options.allowTag === false
      ? null
      : findStringDeep(payload, ["tag_name", "uchat_tag"]) ||
        nonEmptyString(workspace.default_tag_name);

  const responses: JsonRecord[] = [];
  const executedActions: string[] = [];
  const skippedActions: string[] = [];
  let subflowDeliveryMethod: "user_ns" | "user_id" | null = null;
  const deliveryKey = resolveInboundDeliveryKey(source, payload, eventId);

  if (subflowNs) {
    const actionKey = `${workspace.id}:subflow:${subflowNs}:event:${deliveryKey}`;
    const actionId = await claimRoutingAction(
      supabase,
      launch.id,
      contact.id,
      eventId,
      source,
      "uchat",
      "send-sub-flow",
      actionKey,
      { workspaceId: workspace.workspace_id, userNs, subflowNs },
    );

    if (actionId) {
      try {
        const response = (await uchatRequest(
          workspace.api_token,
          targetUserId ? "/subscriber/send-sub-flow-by-user-id" : "/subscriber/send-sub-flow",
          "POST",
          targetUserId
            ? {
                user_id: targetUserId,
                sub_flow_ns: subflowNs,
              }
            : {
              user_ns: userNs,
              sub_flow_ns: subflowNs,
            },
        )) as JsonRecord;

        await updateRoutingAction(supabase, actionId, "success", response);
        responses.push({ action: "send-sub-flow", response });
        executedActions.push("send-sub-flow");
        subflowDeliveryMethod = targetUserId ? "user_id" : "user_ns";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateRoutingAction(supabase, actionId, "failed", {}, message);
        throw error;
      }
    } else {
      skippedActions.push("send-sub-flow");
    }
  }

  if (tagName) {
    const actionKey = `${workspace.id}:tag:${tagName}`;
    const actionId = await claimRoutingAction(
      supabase,
      launch.id,
      contact.id,
      eventId,
      source,
      "uchat",
      "add-tag",
      actionKey,
      { workspaceId: workspace.workspace_id, userNs, tagName },
    );

    if (actionId) {
      try {
        const response = (await uchatRequest(workspace.api_token, "/subscriber/add-tag-by-name", "POST", {
          user_ns: userNs,
          tag_name: tagName,
        })) as JsonRecord;

        await updateRoutingAction(supabase, actionId, "success", response);
        responses.push({ action: "add-tag", response });
        executedActions.push("add-tag");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateRoutingAction(supabase, actionId, "failed", {}, message);
        throw error;
      }
    } else {
      skippedActions.push("add-tag");
    }
  }

  if (!subflowNs && !tagName) {
    await insertProcessingLog(
      supabase,
      launch.id,
      contact.id,
      eventId,
      source,
      "warning",
      "UCHAT_NO_ACTION_CONFIGURED",
      "Roteamento sem acao no UChat",
      "O evento chegou ao Launch Hub, mas nao existe subflow ou tag padrao configurados para enviar de volta ao UChat.",
      { workspaceId: workspace.workspace_id },
    );
  }

  return {
    target: "uchat",
    workspaceId: workspace.workspace_id,
    userNs,
    dispatched: responses.length,
    configuredSubflowNs: subflowNs,
    configuredTagName: tagName,
    executedActions,
    skippedActions,
    subflowDeliveryMethod,
    payloadUserId: targetUserId,
    recipientResolution: recipient.resolutionSource,
    deliveryKey,
  };
}

async function routeToActiveCampaign(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  contact: LeadContactRow,
  eventId: string,
  source: WebhookSource,
  payload: JsonRecord,
) {
  const tagNames = resolveActiveCampaignTags(source, payload, parseNamedTags(launch.ac_named_tags));
  const fieldValues = extractActiveCampaignFieldValues(source, payload);

  if (source === "sendflow" && tagNames.length === 0) {
    await insertProcessingLog(
      supabase,
      launch.id,
      contact.id,
      eventId,
      source,
      "warning",
      "SENDFLOW_ACTIVE_TAG_NOT_CONFIGURED",
      "Sendflow sem tag do ActiveCampaign",
      "O contato do Sendflow sera pesquisado/enviado ao ActiveCampaign pelo telefone, mas nenhuma tag foi resolvida para aplicar. Configure uma tag no bloco Sendflow em Fontes.",
      {
        inboundAliases: extractTagAliases(payload, source),
        inboundTags: extractTagNames(payload),
      },
    );
  }

  if (source === "uchat" && tagNames.length === 0) {
    await insertProcessingLog(
      supabase,
      launch.id,
      contact.id,
      eventId,
      source,
      "info",
      "UCHAT_TAG_NOT_ELIGIBLE",
      "Contato do UChat sem tag elegivel",
      "O webhook do UChat chegou, mas o subscriber nao estava com nenhuma tag/estado mapeados para envio ao ActiveCampaign.",
      {
        inboundTags: extractTagNames(payload),
        inboundAliases: extractTagAliases(payload),
        subscriberTags: Array.isArray(payload.uchat_current_tags) ? payload.uchat_current_tags : [],
      },
    );

    return {
      target: "activecampaign",
      skipped: true,
      reason: "uchat_no_matching_tag",
    };
  }

  const actionKey = JSON.stringify({
    listId: launch.ac_default_list_id || null,
    fieldValues: fieldValues.map((item) => `${item.fieldId}:${item.value}`).sort(),
    tags: [...tagNames].sort(),
  });

  const actionId = await claimRoutingAction(
    supabase,
    launch.id,
    contact.id,
    eventId,
    source,
    "activecampaign",
    "sync-contact",
    actionKey,
    {
      email: contact.primary_email,
      phone: contact.primary_phone,
      fieldValues,
      tags: tagNames,
      listId: launch.ac_default_list_id,
      phoneCandidates: source === "sendflow"
        ? buildPhoneSearchCandidates([contact.primary_phone, contact.normalized_phone])
        : [],
    },
  );

  if (!actionId) {
    return {
      target: "activecampaign",
      skipped: true,
    };
  }

  try {
    const existingIdentity = await fetchLeadIdentity(
      supabase,
      launch.id,
      contact.id,
      "activecampaign",
    );
    const sendflowPhoneFromPayload =
      source === "sendflow" ? findStringDeep(payload, ["number"]) : null;
    const response = await syncContactToActiveCampaign(
      launch,
      contact,
      tagNames,
      fieldValues,
      existingIdentity?.external_contact_id || null,
      source === "sendflow"
        ? { phoneOnlyMatch: true, phoneSearchValue: sendflowPhoneFromPayload }
        : undefined,
    );

    await upsertLeadIdentity(
      supabase,
      launch.id,
      contact.id,
      "activecampaign",
      response.activeContactId,
      contact.primary_email,
      contact.primary_phone,
      {
        contact_id: response.activeContactId,
        applied_field_values: response.appliedFieldValues,
        applied_tags: response.appliedTags,
        matched_by: response.matchedBy,
        operation: response.operation,
      },
    );

    await updateRoutingAction(supabase, actionId, "success", response as unknown as JsonRecord);
    return {
      target: "activecampaign",
      contactId: response.activeContactId,
      fieldValuesApplied: response.appliedFieldValues,
      tagsApplied: response.appliedTags,
      matchedBy: response.matchedBy,
      operation: response.operation,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateRoutingAction(supabase, actionId, "failed", {}, message);
    throw error;
  }
}

async function dispatchRoutes(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  normalizedEvent: NormalizedWebhookEvent,
  processedContactId: string,
  eventId: string,
) {
  const contact = await fetchLeadContact(supabase, processedContactId);
  const namedTags = parseNamedTags(launch.ac_named_tags);
  const activePayloadTags = extractTagNames(normalizedEvent.payload);
  const configuredTagNames = namedTags.map((item) => item.tag);
  const routingPayload =
    normalizedEvent.source === "uchat"
      ? enrichPayloadWithUchatState(
          normalizedEvent.payload,
          await loadUchatSubscriberState(
            supabase,
            launch.id,
            contact,
            normalizedEvent.payload,
          ),
        )
      : normalizedEvent.payload;

  if (
    normalizedEvent.source === "activecampaign" &&
    activePayloadTags.some((tagName) =>
      configuredTagNames.some((configuredTag) => normalizeKey(configuredTag) === normalizeKey(tagName))
    )
  ) {
    await insertProcessingLog(
      supabase,
      launch.id,
      contact.id,
      eventId,
      normalizedEvent.source,
      "info",
      "ACTIVE_ALREADY_TAGGED_CONTINUING",
      "Contato ja possui as tags do expert",
      "O evento vindo do ActiveCampaign ja chegou com tags do expert. Mesmo assim, o Launch Hub continuou o retorno para o UChat porque esse webhook pode ser usado como gatilho explicito do subflow.",
      { inboundTags: activePayloadTags, configuredTags: configuredTagNames },
    );
  }

  if (normalizedEvent.source === "uchat") {
    let activeVerification:
      | {
          target: string;
          skipped: boolean;
          reason: string;
        }
      | {
          target: string;
          matched: boolean;
          activeContactId?: string;
          matchedBy?: string;
        }
      | null = null;

    try {
      activeVerification = await verifyContactAgainstActiveCampaign(
        supabase,
        launch,
        contact,
        eventId,
        normalizedEvent.source,
      );

      if ("skipped" in activeVerification && activeVerification.skipped) {
        await insertProcessingLog(
          supabase,
          launch.id,
          contact.id,
          eventId,
          normalizedEvent.source,
          "info",
          "ACTIVECAMPAIGN_VERIFICATION_SKIPPED",
          "Verificacao do ActiveCampaign ignorada",
          "O webhook do UChat foi aceito, mas a verificacao de duplicidade no ActiveCampaign foi ignorada por falta de configuracao ou dado minimo de busca.",
          activeVerification as unknown as JsonRecord,
        );
      } else if ("matched" in activeVerification && activeVerification.matched) {
        await insertProcessingLog(
          supabase,
          launch.id,
          contact.id,
          eventId,
          normalizedEvent.source,
          "success",
          "ACTIVECAMPAIGN_DUPLICATE_LINKED",
          "Contato ja existia no ActiveCampaign",
          "O Launch Hub encontrou um contato compativel no ActiveCampaign e vinculou a identidade existente sem reenviar o webhook do proprio UChat ao subflow de boas-vindas.",
          activeVerification as unknown as JsonRecord,
        );
      } else {
        await insertProcessingLog(
          supabase,
          launch.id,
          contact.id,
          eventId,
          normalizedEvent.source,
          "info",
          "ACTIVECAMPAIGN_DUPLICATE_NOT_FOUND",
          "Nenhum duplicado encontrado no ActiveCampaign",
          "O Launch Hub consultou o ActiveCampaign, nao encontrou um contato correspondente e finalizou o tratamento sem retorno ao subflow de boas-vindas.",
          activeVerification as unknown as JsonRecord,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await insertProcessingLog(
        supabase,
        launch.id,
        contact.id,
        eventId,
        normalizedEvent.source,
        "warning",
        "ACTIVECAMPAIGN_VERIFICATION_FAILED",
        "Falha ao consultar o ActiveCampaign",
        "A verificacao de duplicidade no ActiveCampaign falhou, mas o webhook do proprio UChat nao sera reenviado ao subflow de boas-vindas.",
        { error: message },
      );
    }

    await insertProcessingLog(
      supabase,
      launch.id,
      contact.id,
      eventId,
      normalizedEvent.source,
      "info",
      "UCHAT_WEBHOOK_PROCESSED_NO_RETURN",
      "Webhook do UChat tratado sem retorno",
      "Eventos recebidos pelo webhook do proprio UChat ficam apenas no tratamento e na verificacao de duplicidade. O subflow padrao de boas-vindas fica reservado ao webhook do Sendflow.",
      activeVerification ? ({ activeVerification } as JsonRecord) : {},
    );

    return {
      checkedActiveCampaign: activeVerification,
      returnedToUchat: false,
      reason: "uchat_webhook_does_not_return_to_welcome_subflow",
    };
  }

  let activeCampaignRoute: JsonRecord | null = null;

  if (["manychat", "typebot", "tally", "sendflow"].includes(normalizedEvent.source)) {
    try {
      const routed = await routeToActiveCampaign(
        supabase,
        launch,
        contact,
        eventId,
        normalizedEvent.source,
        routingPayload,
      );

      activeCampaignRoute = routed as unknown as JsonRecord;

      if ("appliedTags" in routed && Array.isArray(routed.appliedTags)) {
        await updateLeadJourneyData(
          supabase,
          contact,
          normalizedEvent.source,
          routingPayload,
          {
            tags: routed.appliedTags as string[],
          },
        );
      }

      if (!("skipped" in routed) || !routed.skipped) {
        await insertProcessingLog(
          supabase,
          launch.id,
          contact.id,
          eventId,
          normalizedEvent.source,
          "success",
          "ROUTED_TO_ACTIVECAMPAIGN",
          "Contato enviado ao ActiveCampaign",
          "O Launch Hub enviou o contato tratado para o ActiveCampaign depois da verificacao de estado.",
          routed as unknown as JsonRecord,
        );
      }

      if (["manychat", "typebot", "tally"].includes(normalizedEvent.source)) {
        return routed;
      }
    } catch (error) {
      if (normalizedEvent.source !== "sendflow") {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      activeCampaignRoute = {
        failed: true,
        error: message,
      } satisfies JsonRecord;

      await insertProcessingLog(
        supabase,
        launch.id,
        contact.id,
        eventId,
        normalizedEvent.source,
        "warning",
        "ROUTING_TO_ACTIVECAMPAIGN_FAILED",
        "Falha ao enviar contato ao ActiveCampaign",
        "O contato do Sendflow foi tratado, mas o envio complementar ao ActiveCampaign falhou. O retorno ao UChat continuou normalmente.",
        {
          error: message,
        },
      );
    }
  }

  if (["activecampaign", "sendflow"].includes(normalizedEvent.source)) {
    try {
      const requestedTagName = findStringDeep(normalizedEvent.payload, ["tag_name", "uchat_tag"]);
      const routed = await routeToUchat(
        supabase,
        launch,
        contact,
        eventId,
        normalizedEvent.source,
        normalizedEvent.payload,
        {
          allowSubflow: true,
          allowWorkspaceDefaultSubflow: normalizedEvent.source === "sendflow",
          allowTag: Boolean(requestedTagName),
          requireExplicitRecipient: true,
        },
      );

      await insertProcessingLog(
        supabase,
        launch.id,
        contact.id,
        eventId,
        normalizedEvent.source,
        "success",
        "ROUTED_TO_UCHAT",
        "Contato enviado ao UChat",
        "O Launch Hub encaminhou o contato tratado para o UChat com a acao configurada do expert.",
        routed as unknown as JsonRecord,
      );

      if (isRecord(routed)) {
        const routedTag = nonEmptyString(routed.configuredTagName);
        await updateLeadJourneyData(
          supabase,
          contact,
          normalizedEvent.source,
          normalizedEvent.payload,
          {
            tags: routedTag ? [routedTag] : [],
          },
        );
      }

      if (normalizedEvent.source === "sendflow") {
        return {
          activeCampaign: activeCampaignRoute,
          uchatReturn: routed,
        };
      }

      return routed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await insertProcessingLog(
        supabase,
        launch.id,
        contact.id,
        eventId,
        normalizedEvent.source,
        "error",
        "ROUTING_TO_UCHAT_FAILED",
        "Falha ao reenviar contato ao UChat",
        "O contato entrou no Launch Hub e foi tratado, mas a etapa de retorno ao UChat falhou durante o disparo da acao configurada.",
        {
          error: message,
          configuredSubflowNs:
            findStringDeep(normalizedEvent.payload, ["subflow_ns", "subflow", "welcome_subflow_ns"]) || null,
          workspaceHint:
            findStringDeep(normalizedEvent.payload, ["workspace_id", "workspaceId", "uchat_workspace_id", "bot_id"]) ||
            null,
          activeCampaignRoute,
        },
      );
      throw error;
    }
  }

  return { skipped: true, reason: "no_route_defined" };
}

async function runAcceptedContactJobs(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  normalizedEvent: NormalizedWebhookEvent,
  processedContactId: string,
  eventId: string,
  options: {
    includeGoogleSheets?: boolean;
  } = {},
) {
  const { includeGoogleSheets = true } = options;
  let contact: LeadContactRow | null = null;

  try {
    contact = await fetchLeadContact(supabase, processedContactId);

    await updateLeadJourneyData(
      supabase,
      contact,
      normalizedEvent.source,
      normalizedEvent.payload,
    );

    const routingResult = await dispatchRoutes(
      supabase,
      launch,
      normalizedEvent,
      contact.id,
      eventId,
    );

    if (includeGoogleSheets && normalizedEvent.source === "activecampaign") {
      await appendActiveCampaignWebhookToGoogleSheetsJob(
        supabase,
        launch,
        normalizedEvent,
        contact,
        eventId,
      );
    }

    return routingResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (contact) {
      await insertProcessingLog(
        supabase,
        launch.id,
        contact.id,
        eventId,
        normalizedEvent.source,
        "error",
        "BACKGROUND_ROUTING_FAILED",
        "Falha no processamento apos aceite do webhook",
        "O Launch Hub aceitou o webhook rapidamente, mas uma etapa posterior de roteamento falhou.",
        { error: message },
      );
    }

    throw error;
  }
}

async function appendActiveCampaignWebhookToGoogleSheetsJob(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  normalizedEvent: NormalizedWebhookEvent,
  contactOrContactId: LeadContactRow | string,
  eventId: string,
) {
  const contact =
    typeof contactOrContactId === "string"
      ? await fetchLeadContact(supabase, contactOrContactId)
      : contactOrContactId;

  try {
    await appendActiveCampaignWebhookToGoogleSheets(
      supabase,
      launch,
      contact,
      normalizedEvent.payload,
      eventId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await insertProcessingLog(
      supabase,
      launch.id,
      contact.id,
      eventId,
      normalizedEvent.source,
      "warning",
      "GOOGLE_SHEETS_APPEND_FAILED",
      "Falha ao registrar no Google Sheets",
      "O webhook do ActiveCampaign foi tratado, mas o espelhamento para a planilha configurada falhou.",
      { error: message },
    );
  }
}

async function enqueueLaunchWebhookJob(
  supabase: AnySupabaseClient,
  launchId: string,
  normalizedEvent: NormalizedWebhookEvent,
) {
  const { data, error } = await supabase
    .from("launch_webhook_jobs")
    .insert({
      launch_id: launchId,
      source: normalizedEvent.source,
      event_type: normalizedEvent.eventType,
      payload: normalizedEvent.payload,
      status: "pending",
    } as Record<string, unknown>)
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new ProcessContactError(
      "Failed to queue ActiveCampaign webhook job",
      500,
      error?.message,
    );
  }

  return data.id as string;
}

function isFreshRunningWebhookJob(job: LaunchWebhookJobRow) {
  if (job.status !== "running" || !job.updated_at) return false;

  const updatedAtMs = Date.parse(job.updated_at);
  if (!Number.isFinite(updatedAtMs)) return false;

  return Date.now() - updatedAtMs < 2 * 60 * 1000;
}

async function updateLaunchWebhookJob(
  supabase: AnySupabaseClient,
  jobId: string,
  values: Record<string, unknown>,
) {
  await supabase
    .from("launch_webhook_jobs")
    .update(values)
    .eq("id", jobId);
}

async function processQueuedLaunchWebhookJob(
  supabase: AnySupabaseClient,
  jobId: string,
) {
  const { data, error } = await supabase
    .from("launch_webhook_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new ProcessContactError("Failed to load webhook job", 500, error.message);
  }

  if (!data) {
    throw new ProcessContactError("Webhook job not found", 404);
  }

  const job = data as LaunchWebhookJobRow;

  if (job.status === "success") {
    return {
      accepted: true,
      skipped: true,
      reason: "job_already_processed",
      jobId,
    };
  }

  if (isFreshRunningWebhookJob(job)) {
    return {
      accepted: true,
      skipped: true,
      reason: "job_already_running",
      jobId,
    };
  }

  const nextAttempts = (job.attempts || 0) + 1;
  await updateLaunchWebhookJob(supabase, jobId, {
    status: "running",
    attempts: nextAttempts,
    started_at: new Date().toISOString(),
    last_error: null,
  });

  try {
    const launch = await fetchLaunch(supabase, job.launch_id, null);
    const normalizedEvent = normalizeIncomingWebhook(job.source, job.payload);
    const processingResult = await processIncomingContactEvent(supabase, {
      launchId: launch.id,
      source: normalizedEvent.source,
      eventType: normalizedEvent.eventType,
      externalContactId: normalizedEvent.externalContactId,
      contact: normalizedEvent.contact,
      payload: normalizedEvent.payload,
    } as IncomingEventBody);

    if (processingResult.status === "rejected" || !processingResult.contactId || !processingResult.eventId) {
      await updateLaunchWebhookJob(supabase, jobId, {
        status: "success",
        processed_at: new Date().toISOString(),
        response_payload: {
          accepted: false,
          processing: processingResult,
        },
      });

      return {
        accepted: false,
        jobId,
        processing: processingResult,
      };
    }

    const routingResult = await runAcceptedContactJobs(
      supabase,
      launch,
      normalizedEvent,
      processingResult.contactId,
      processingResult.eventId,
      { includeGoogleSheets: true },
    );

    const responsePayload = {
      accepted: true,
      processing: processingResult,
      routing: routingResult,
    };

    await updateLaunchWebhookJob(supabase, jobId, {
      status: "success",
      processed_at: new Date().toISOString(),
      response_payload: responsePayload,
    });

    return {
      jobId,
      ...responsePayload,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldRetry = nextAttempts < 5;

    await updateLaunchWebhookJob(supabase, jobId, {
      status: shouldRetry ? "pending" : "failed",
      last_error: message,
      next_attempt_at: shouldRetry
        ? new Date(Date.now() + Math.min(nextAttempts * 30_000, 5 * 60_000)).toISOString()
        : null,
    });

    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
  }

  const url = new URL(request.url);
  const workerJobId = nonEmptyString(url.searchParams.get("workerJobId"));
  if (workerJobId) {
    const expectedSecret =
      Deno.env.get("LAUNCHHUB_WEBHOOK_WORKER_SECRET") ||
      Deno.env.get("LAUNCHHUB_SYNC_CRON_SECRET");
    const providedSecret = nonEmptyString(request.headers.get("x-launchhub-worker-secret"));

    if (!expectedSecret || providedSecret !== expectedSecret) {
      return jsonResponse({ error: "Invalid webhook worker secret" }, 403);
    }

    try {
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const result = await processQueuedLaunchWebhookJob(supabase, workerJobId);
      return jsonResponse(result);
    } catch (error) {
      if (error instanceof ProcessContactError) {
        return jsonResponse(
          {
            error: error.message,
            details: error.details ?? null,
          },
          error.statusCode,
        );
      }

      console.error("launch-webhook-router worker failed", error);
      return jsonResponse({ error: "Unexpected webhook worker error" }, 500);
    }
  }

  const source = normalizeWebhookSource(url.searchParams.get("source"));
  const launchId =
    nonEmptyString(url.searchParams.get("expertId")) ||
    nonEmptyString(url.searchParams.get("launchId"));
  const launchSlug =
    nonEmptyString(url.searchParams.get("expertSlug")) ||
    nonEmptyString(url.searchParams.get("launchSlug"));
  const token = nonEmptyString(url.searchParams.get("token"));

  if (!source) {
    return jsonResponse({ error: "Missing or invalid source" }, 400);
  }

  if (!launchId && !launchSlug) {
    return jsonResponse({ error: "expertId or expertSlug is required" }, 400);
  }

  try {
    const payload = await parseRequestBody(request);
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const launch = await fetchLaunch(supabase, launchId, launchSlug);

    if (!token || token !== launch.webhook_secret) {
      return jsonResponse({ error: "Invalid webhook token" }, 403);
    }

    const normalizedEvent = normalizeIncomingWebhook(source, payload);

    if (normalizedEvent.source === "activecampaign") {
      const jobId = await enqueueLaunchWebhookJob(supabase, launch.id, normalizedEvent);

      return jsonResponse({
        accepted: true,
        queued: true,
        jobId,
        routing: {
          queued: true,
          reason: "activecampaign_webhook_queued_for_async_processing",
        },
      });
    }

    const processingResult = await processIncomingContactEvent(supabase, {
      launchId: launch.id,
      source: normalizedEvent.source,
      eventType: normalizedEvent.eventType,
      externalContactId: normalizedEvent.externalContactId,
      contact: normalizedEvent.contact,
      payload: normalizedEvent.payload,
    } as IncomingEventBody);

    if (processingResult.status === "rejected" || !processingResult.contactId || !processingResult.eventId) {
      return jsonResponse({
        accepted: false,
        processing: processingResult,
      });
    }

    const routingResult = await runAcceptedContactJobs(
      supabase,
      launch,
      normalizedEvent,
      processingResult.contactId,
      processingResult.eventId,
    );

    return jsonResponse({
      accepted: true,
      processing: processingResult,
      routing: routingResult,
    });
  } catch (error) {
    if (error instanceof ProcessContactError) {
      return jsonResponse(
        {
          error: error.message,
          details: error.details ?? null,
        },
        error.statusCode,
      );
    }

    console.error("launch-webhook-router failed", error);
    return jsonResponse({ error: "Unexpected routing error" }, 500);
  }
});

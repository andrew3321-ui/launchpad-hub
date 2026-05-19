import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { insertContactLogs } from "../_shared/contact-logging.ts";
import { ProcessContactError } from "../_shared/contact-processing.ts";
import {
  appendGoogleSheetsRows,
  parseGoogleSheetsConfig,
  readGoogleSheetsValues,
  updateGoogleSheetsRanges,
  type GoogleSheetsAuthMode,
} from "../_shared/google-sheets.ts";

type AnySupabaseClient = any;
type JsonRecord = Record<string, unknown>;

interface LaunchGoogleSheetsRow {
  id: string;
  name: string;
  current_cycle_number: number;
  ac_api_url: string | null;
  ac_api_key: string | null;
  gs_auth_mode: GoogleSheetsAuthMode | null;
  gs_enabled: boolean;
  gs_oauth_refresh_token: string | null;
  gs_private_key: string | null;
  gs_service_account_email: string | null;
  gs_sheet_name: string | null;
  gs_spreadsheet_id: string | null;
  gs_capture_tag_id: string | null;
  gs_capture_tag_name: string | null;
  gs_default_product_name: string | null;
}

interface CsvMapping {
  value?: string | null;
  staticValue?: string | null;
  csvColumn?: string | null;
  sheetColumn: string;
}

interface NormalizedCsvMapping {
  value: string | null;
  csvColumn: string | null;
  sheetColumn: string;
}

interface BulkUpdateBody {
  launchId?: string | null;
  emailColumn?: string | null;
  mode?: "fixed_update" | "active_export_import" | null;
  mappings?: CsvMapping[] | null;
  rows?: JsonRecord[] | null;
  skipBlankValues?: boolean | null;
}

interface ActiveCampaignContact {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  createdAt: string | null;
}

interface ActiveCampaignFieldDefinition {
  id: string;
  keys: string[];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ROWS_PER_REQUEST = 400;
const MAX_MAPPINGS_PER_REQUEST = 30;
const MAX_SHEET_UPDATES_PER_REQUEST = 25000;
const CSV_NAME_CANDIDATES = [
  "Nome completo",
  "Nome",
  "Name",
  "Full Name",
  "Contact Name",
];
const CSV_FIRST_NAME_CANDIDATES = ["First Name", "FirstName", "first_name", "contact[first_name]"];
const CSV_LAST_NAME_CANDIDATES = ["Last Name", "LastName", "last_name", "contact[last_name]"];
const CSV_PHONE_CANDIDATES = [
  "Telefone",
  "Numero de telefone",
  "Número de telefone",
  "Numero telefone",
  "Número telefone",
  "Phone",
  "Phone Number",
  "Contact Phone",
  "Celular",
  "Mobile",
  "Whatsapp",
  "WhatsApp",
  "contact[phone]",
];
const CSV_ID_CANDIDATES = ["ID", "Contact ID", "Contact Id", "id", "contact[id]"];
const CSV_CREATED_AT_CANDIDATES = [
  "Created",
  "Created At",
  "Date Created",
  "Created Date",
  "CDate",
  "cdate",
  "Data do Cadastro",
  "Data de Cadastro",
  "Data da criação",
  "Data de criação",
  "contact[cdate]",
];
const SHEET_PHONE_COLUMNS = ["Telefone", "Phone", "Celular", "Whatsapp", "WhatsApp"];
const CSV_CAPTURE_COLUMN_ALIASES: Record<string, string[]> = {
  data: ["Data", "Data do Evento", "data_evento", "event_date"],
  nome: ["Nome", "Nome completo", "Name", "Full Name", "Contact Name"],
  email: ["Email", "E-mail", "Email Address", "Contact Email", "contact[email]"],
  telefone: CSV_PHONE_CANDIDATES,
  tipodelead: ["Tipo de Lead", "Lead Type", "lead_type", "tipo_de_lead", "Status", "Lead Status"],
  produto: ["Produto", "Product", "Product Name", "produto", "product_name"],
  utmsource: ["UTM SOURCE", "UTM Source", "utm_source"],
  utmcampaign: ["UTM CAMPAIGN", "UTM Campaign", "utm_campaign"],
  utmmedium: ["UTM MEDIUM", "UTM Medium", "utm_medium"],
  utmcontent: ["UTM CONTENT", "UTM Content", "utm_content"],
  utmterm: ["UTM TERM", "UTM Term", "utm_term"],
  utmsite: ["UTM SITE", "UTM Site", "utm_site"],
  datadocadastro: CSV_CREATED_AT_CANDIDATES,
  vlrdash: ["Vlr Dash", "Valor Dash", "Dash", "dashboard_value"],
  hotlead: ["HOTLEAD", "Hot Lead", "hotlead"],
  vksource: ["vk_source", "VK Source"],
  vkadid: ["vk_ad_id", "VK Ad ID"],
};
const TARGET_FIELD_ALIASES: Record<string, string[]> = {
  data_evento: ["data_evento", "data do evento", "data evento"],
  tipo_de_lead: ["tipo_de_lead", "tipo de lead"],
  produto: ["produto", "product"],
  utm_source: ["utm_source", "utm source"],
  utm_campaign: ["utm_campaign", "utm campaign"],
  utm_medium: ["utm_medium", "utm medium"],
  utm_content: ["utm_content", "utm content"],
  utm_term: ["utm_term", "utm term"],
  utm_site: ["utm_site", "utm site"],
  data_de_cadastro: ["data_de_cadastro", "data de cadastro", "data do cadastro"],
  dashboard_value: ["dashboard_value", "vlr dash", "valor dash", "dash"],
  hotlead: ["hotlead", "hot lead"],
  vk_source: ["vk_source", "vk source"],
  vk_ad_id: ["vk_ad_id", "vk ad id"],
};
const STANDARD_CAPTURE_HEADER = [
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
];

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
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeEmail(value: unknown) {
  const email = nonEmptyString(value)?.toLowerCase() ?? null;
  if (!email || !email.includes("@")) return null;
  return email;
}

function normalizeColumnKey(value: unknown) {
  return nonEmptyString(value)
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "") ?? "";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map(nonEmptyString).filter((value): value is string => Boolean(value)))];
}

function digitsOnly(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeBrazilianLocalDigits(rawDigits: string) {
  const trimmedDigits = rawDigits.replace(/^0+/, "");
  return trimmedDigits.startsWith("55") && [12, 13].includes(trimmedDigits.length)
    ? trimmedDigits.slice(2)
    : trimmedDigits;
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

function normalizeBrazilianPhone(value: unknown) {
  const digits = digitsOnly(value);
  if (!digits) return null;

  const localDigits = normalizeBrazilianLocalDigits(digits);
  const variants = addBrazilianPhoneNinthDigitVariants(localDigits)
    .filter((variant) => /^[1-9]{2}9?\d{8}$/.test(variant))
    .sort((left, right) => {
      const leftHasNinth = /^[1-9]{2}9[6-9]\d{7}$/.test(left) ? 1 : 0;
      const rightHasNinth = /^[1-9]{2}9[6-9]\d{7}$/.test(right) ? 1 : 0;
      return rightHasNinth - leftHasNinth || right.length - left.length;
    });

  if (variants.length > 0) return `55${variants[0]}`;
  return digits.replace(/^0+/, "") || digits;
}

function buildPhoneDedupeKey(value: unknown) {
  const digits = digitsOnly(value);
  if (!digits) return null;

  let localDigits = normalizeBrazilianLocalDigits(digits);
  if (/^[1-9]{2}9[6-9]\d{7}$/.test(localDigits)) {
    localDigits = `${localDigits.slice(0, 2)}${localDigits.slice(3)}`;
  }

  if (/^[1-9]{2}9?\d{8}$/.test(localDigits)) {
    return `br:${localDigits}`;
  }

  return `raw:${digits.replace(/^0+/, "") || digits}`;
}

function buildCaptureFingerprint(contact: ActiveCampaignContact) {
  const email = contact.email ? `email:${contact.email.toLowerCase()}` : null;
  const phoneKey = buildPhoneDedupeKey(contact.phone);
  const phone = normalizeBrazilianPhone(contact.phone);
  return normalizeColumnKey(
    email ||
      (phoneKey ? `phone:${phoneKey}` : null) ||
      (phone ? `phone:${phone}` : null) ||
      `active:${contact.id}`,
  );
}

function columnLetters(index: number) {
  let value = index + 1;
  let output = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    output = String.fromCharCode(65 + remainder) + output;
    value = Math.floor((value - 1) / 26);
  }

  return output;
}

function firstStringFromRow(row: JsonRecord, key: string) {
  const directValue = row[key];
  if (directValue !== undefined) return nonEmptyString(directValue) ?? "";

  const normalizedKey = normalizeColumnKey(key);
  const matchedEntry = Object.entries(row).find(([rowKey]) => normalizeColumnKey(rowKey) === normalizedKey);
  return matchedEntry ? nonEmptyString(matchedEntry[1]) ?? "" : "";
}

function firstStringFromAnyRowColumn(row: JsonRecord, candidates: string[]) {
  for (const candidate of candidates) {
    const value = firstStringFromRow(row, candidate);
    if (value) return value;
  }

  return "";
}

function pickNameFromCsvRow(row: JsonRecord) {
  const fullName = firstStringFromAnyRowColumn(row, CSV_NAME_CANDIDATES);
  if (fullName) return fullName;

  const firstName = firstStringFromAnyRowColumn(row, CSV_FIRST_NAME_CANDIDATES);
  const lastName = firstStringFromAnyRowColumn(row, CSV_LAST_NAME_CANDIDATES);
  return [firstName, lastName].filter(Boolean).join(" ").trim() || null;
}

function pickPhoneFromCsvRow(row: JsonRecord) {
  return firstStringFromAnyRowColumn(row, CSV_PHONE_CANDIDATES) || null;
}

function pickCreatedAtFromCsvRow(row: JsonRecord) {
  return firstStringFromAnyRowColumn(row, CSV_CREATED_AT_CANDIDATES) || null;
}

function buildActiveCampaignContactFromCsvRow(email: string | null, row: JsonRecord): ActiveCampaignContact {
  const fullName = pickNameFromCsvRow(row) ?? "";
  const firstName = firstStringFromAnyRowColumn(row, CSV_FIRST_NAME_CANDIDATES);
  const lastName = firstStringFromAnyRowColumn(row, CSV_LAST_NAME_CANDIDATES);
  const phone = pickPhoneFromCsvRow(row);
  const fallbackId = email
    ? `csv:${email}`
    : phone
      ? `csvphone:${normalizeColumnKey(phone)}`
      : `csvrow:${normalizeColumnKey(fullName) || "unknown"}`;
  const splitName = fullName.split(/\s+/).filter(Boolean);

  return {
    id: firstStringFromAnyRowColumn(row, CSV_ID_CANDIDATES) || fallbackId,
    email,
    phone,
    firstName: firstName || splitName[0] || null,
    lastName: lastName || (splitName.length > 1 ? splitName.slice(1).join(" ") : null),
    createdAt: pickCreatedAtFromCsvRow(row),
  };
}

function findHeaderColumnIndex(headerIndex: Map<string, number>, candidates: string[]) {
  for (const candidate of candidates) {
    const index = headerIndex.get(normalizeColumnKey(candidate));
    if (index !== undefined) return index;
  }

  return undefined;
}

function normalizedSheetCell(value: unknown) {
  return String(value ?? "").trim();
}

function shouldUpdateSheetCell(currentValue: unknown, nextValue: string) {
  return normalizedSheetCell(currentValue) !== nextValue.trim();
}

function shouldFillBlankSheetCell(currentValue: unknown, nextValue: unknown) {
  return !normalizedSheetCell(currentValue) && Boolean(nonEmptyString(nextValue));
}

async function requireAuthenticatedUser(request: Request, supabaseUrl: string, serviceRoleKey: string) {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authorization) {
    throw new ProcessContactError("Missing authorization header", 401);
  }

  const userAuthKey =
    Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
    Deno.env.get("SB_PUBLISHABLE_KEY") ||
    serviceRoleKey;

  const authClient = createClient(supabaseUrl, userAuthKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();

  if (error || !user) {
    throw new ProcessContactError("Unauthorized", 401, error?.message);
  }

  return user;
}

async function assertLaunchAccess(
  supabase: AnySupabaseClient,
  userId: string,
  launchId: string | null,
) {
  if (!launchId) {
    throw new ProcessContactError("launchId is required", 400);
  }

  const { data: allowed, error } = await supabase.rpc("user_owns_launch", {
    _launch_id: launchId,
    _user_id: userId,
  });

  if (error) {
    throw new ProcessContactError("Failed to validate expert access", 500, error.message);
  }

  if (!allowed) {
    throw new ProcessContactError("Expert access denied", 403);
  }
}

async function fetchLaunchGoogleSheetsConfig(
  supabase: AnySupabaseClient,
  launchId: string,
) {
  const { data, error } = await supabase
    .from("launches")
    .select("id, name, current_cycle_number, ac_api_url, ac_api_key, gs_auth_mode, gs_enabled, gs_oauth_refresh_token, gs_private_key, gs_service_account_email, gs_sheet_name, gs_spreadsheet_id, gs_capture_tag_id, gs_capture_tag_name, gs_default_product_name")
    .eq("id", launchId)
    .maybeSingle();

  if (error || !data) {
    throw new ProcessContactError("Expert Google Sheets settings not found", 404, error?.message);
  }

  return data as LaunchGoogleSheetsRow;
}

function normalizeActiveCampaignBaseUrl(apiUrl: string) {
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/3") ? trimmed.slice(0, -6) : trimmed;
}

async function activeCampaignRequest(
  apiUrl: string,
  apiKey: string,
  path: string,
  query: Record<string, string | number | undefined> = {},
) {
  const url = new URL(`${normalizeActiveCampaignBaseUrl(apiUrl)}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Api-Token": apiKey,
    },
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`ActiveCampaign ${response.status}: ${rawText}`);
  }

  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    return {};
  }
}

function parseActiveCampaignContact(item: unknown): ActiveCampaignContact | null {
  if (!isRecord(item)) return null;
  const id = nonEmptyString(item.id);
  if (!id) return null;

  return {
    id,
    email: nonEmptyString(item.email),
    phone: nonEmptyString(item.phone),
    firstName: nonEmptyString(item.firstName ?? item.first_name),
    lastName: nonEmptyString(item.lastName ?? item.last_name),
    createdAt: nonEmptyString(item.cdate ?? item.created_at ?? item.createdAt),
  };
}

async function fetchActiveCampaignContactByEmail(
  launch: LaunchGoogleSheetsRow,
  email: string,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) return null;

  const queries = [
    { email, limit: 10 },
    { search: email, limit: 20 },
  ];

  for (const query of queries) {
    const payload = await activeCampaignRequest(launch.ac_api_url, launch.ac_api_key, "/api/3/contacts", query);
    const contacts = Array.isArray((payload as JsonRecord).contacts)
      ? ((payload as JsonRecord).contacts as unknown[])
      : [];
    const parsedContacts = contacts
      .map(parseActiveCampaignContact)
      .filter((contact): contact is ActiveCampaignContact => Boolean(contact));

    const exactMatch = parsedContacts.find((contact) => normalizeEmail(contact.email) === email);
    if (exactMatch) return exactMatch;
    if (query.email && parsedContacts[0]) return parsedContacts[0];
  }

  return null;
}

async function fetchActiveCampaignContactByPhone(
  launch: LaunchGoogleSheetsRow,
  phone: string | null,
) {
  if (!launch.ac_api_url || !launch.ac_api_key || !phone) return null;

  const phoneKey = buildPhoneDedupeKey(phone);
  const normalizedPhone = normalizeBrazilianPhone(phone);
  const searchCandidates = uniqueStrings([
    normalizedPhone,
    normalizedPhone ? `+${normalizedPhone}` : null,
    digitsOnly(phone),
    phone,
  ]);

  for (const search of searchCandidates) {
    const payload = await activeCampaignRequest(launch.ac_api_url, launch.ac_api_key, "/api/3/contacts", {
      search,
      limit: 20,
    });
    const contacts = Array.isArray((payload as JsonRecord).contacts)
      ? ((payload as JsonRecord).contacts as unknown[])
      : [];
    const parsedContacts = contacts
      .map(parseActiveCampaignContact)
      .filter((contact): contact is ActiveCampaignContact => Boolean(contact));

    const exactMatch = parsedContacts.find((contact) => {
      const contactPhoneKey = buildPhoneDedupeKey(contact.phone);
      const contactPhone = normalizeBrazilianPhone(contact.phone);
      return (
        (phoneKey && contactPhoneKey === phoneKey) ||
        (normalizedPhone && contactPhone === normalizedPhone)
      );
    });

    if (exactMatch) return exactMatch;
  }

  return null;
}

async function loadActiveCampaignTags(launch: LaunchGoogleSheetsRow) {
  if (!launch.ac_api_url || !launch.ac_api_key) return [] as Array<{ id: string; tag: string }>;

  const tags: Array<{ id: string; tag: string }> = [];
  let offset = 0;

  while (true) {
    const payload = await activeCampaignRequest(launch.ac_api_url, launch.ac_api_key, "/api/3/tags", {
      limit: 100,
      offset,
    });
    const batch = Array.isArray((payload as JsonRecord).tags)
      ? ((payload as JsonRecord).tags as JsonRecord[])
      : [];

    for (const item of batch) {
      const id = nonEmptyString(item.id);
      const tag = nonEmptyString(item.tag);
      if (id && tag) tags.push({ id, tag });
    }

    offset += batch.length;
    if (batch.length < 100) break;
  }

  return tags;
}

async function resolveCaptureTag(launch: LaunchGoogleSheetsRow) {
  const configuredTagId = nonEmptyString(launch.gs_capture_tag_id);
  if (configuredTagId && /^\d+$/.test(configuredTagId)) {
    return {
      id: configuredTagId,
      name: nonEmptyString(launch.gs_capture_tag_name) || configuredTagId,
    };
  }

  const tagName = nonEmptyString(launch.gs_capture_tag_name);
  if (!tagName) return null;

  const tags = await loadActiveCampaignTags(launch);
  const match = tags.find((tag) => normalizeColumnKey(tag.tag) === normalizeColumnKey(tagName));

  return match ? { id: match.id, name: match.tag } : null;
}

async function activeCampaignContactHasTag(
  launch: LaunchGoogleSheetsRow,
  activeContactId: string,
  tagId: string,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) return false;

  const payload = await activeCampaignRequest(
    launch.ac_api_url,
    launch.ac_api_key,
    `/api/3/contacts/${encodeURIComponent(activeContactId)}/contactTags`,
  );
  const contactTags = Array.isArray((payload as JsonRecord).contactTags)
    ? ((payload as JsonRecord).contactTags as JsonRecord[])
    : [];

  return contactTags.some((item) => nonEmptyString(item.tag) === tagId);
}

function fieldDefinitionKeys(item: JsonRecord) {
  const keys = [
    item.title,
    item.perstag,
    item.personalization,
    item.header,
    item.descript,
  ]
    .map(nonEmptyString)
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, value.replace(/%/g, "")])
    .map(normalizeColumnKey)
    .filter(Boolean);

  return [...new Set(keys)];
}

async function loadActiveCampaignFieldDefinitions(launch: LaunchGoogleSheetsRow) {
  if (!launch.ac_api_url || !launch.ac_api_key) return [] as ActiveCampaignFieldDefinition[];

  const fields: ActiveCampaignFieldDefinition[] = [];
  let offset = 0;

  while (true) {
    const payload = await activeCampaignRequest(launch.ac_api_url, launch.ac_api_key, "/api/3/fields", {
      limit: 100,
      offset,
    });
    const batch = Array.isArray((payload as JsonRecord).fields)
      ? ((payload as JsonRecord).fields as JsonRecord[])
      : [];

    for (const item of batch) {
      const id = nonEmptyString(item.id);
      if (!id) continue;
      fields.push({ id, keys: fieldDefinitionKeys(item) });
    }

    offset += batch.length;
    if (batch.length < 100) break;
  }

  return fields;
}

function resolveFieldKey(fieldDefinitions: ActiveCampaignFieldDefinition[], fieldId: string) {
  const definition = fieldDefinitions.find((field) => field.id === fieldId);
  if (!definition) return null;

  for (const [targetKey, aliases] of Object.entries(TARGET_FIELD_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeColumnKey);
    if (definition.keys.some((key) => normalizedAliases.includes(key))) {
      return targetKey;
    }
  }

  return null;
}

async function fetchContactFieldPayload(
  launch: LaunchGoogleSheetsRow,
  fieldDefinitions: ActiveCampaignFieldDefinition[],
  contactId: string,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) return {} as JsonRecord;

  const payload = await activeCampaignRequest(
    launch.ac_api_url,
    launch.ac_api_key,
    `/api/3/contacts/${encodeURIComponent(contactId)}/fieldValues`,
  );
  const fieldValues = Array.isArray((payload as JsonRecord).fieldValues)
    ? ((payload as JsonRecord).fieldValues as JsonRecord[])
    : [];
  const mappedFields: JsonRecord = {};

  for (const fieldValue of fieldValues) {
    const fieldId = nonEmptyString(fieldValue.field);
    const value = nonEmptyString(fieldValue.value);
    if (!fieldId || !value) continue;

    const fieldKey = resolveFieldKey(fieldDefinitions, fieldId);
    if (fieldKey && !mappedFields[fieldKey]) {
      mappedFields[fieldKey] = value;
    }
  }

  if (!nonEmptyString(mappedFields.produto) && nonEmptyString(launch.gs_default_product_name)) {
    mappedFields.produto = launch.gs_default_product_name;
  }

  if (!nonEmptyString(mappedFields.dashboard_value)) {
    mappedFields.dashboard_value = "1";
  }

  return mappedFields;
}

function formatSheetDate(value: unknown) {
  const raw = nonEmptyString(value);
  if (!raw) return null;

  const brDate = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brDate) return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;

  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;

  return new Date(parsed).toISOString().slice(0, 10);
}

function todaySheetDate() {
  return new Date().toISOString().slice(0, 10);
}

function pickActiveCampaignSheetDate(payload: JsonRecord) {
  return (
    formatSheetDate(payload.data_evento) ||
    formatSheetDate(payload["contact[cdate]"]) ||
    formatSheetDate(payload.created_at) ||
    formatSheetDate(payload.createdAt) ||
    todaySheetDate()
  );
}

function pickActiveCampaignRegistrationDate(payload: JsonRecord) {
  return (
    formatSheetDate(payload.data_de_cadastro) ||
    formatSheetDate(payload["contact[cdate]"]) ||
    formatSheetDate(payload.created_at) ||
    formatSheetDate(payload.createdAt) ||
    pickActiveCampaignSheetDate(payload)
  );
}

function normalizeLeadTypeForSheets(value: unknown) {
  const type = nonEmptyString(value);
  if (
    !type ||
    /^(-|n\/a|null|undefined|nao informado|não informado)$/i.test(type) ||
    /^(creat(e)?_?add_?tag|contact_?tag_?add(ed)?|tag_?add(ed)?|add_?tag|webhook_?received)$/i.test(type)
  ) {
    return null;
  }
  return type;
}

function buildContactPayload(contact: ActiveCampaignContact, fieldPayload: JsonRecord) {
  return {
    ...fieldPayload,
    "contact[id]": contact.id,
    "contact[email]": contact.email,
    "contact[phone]": contact.phone,
    "contact[first_name]": contact.firstName,
    "contact[last_name]": contact.lastName,
    "contact[cdate]": contact.createdAt,
  } satisfies JsonRecord;
}

function buildActiveCampaignSheetsRowMap(
  launch: LaunchGoogleSheetsRow,
  contact: ActiveCampaignContact,
  payload: JsonRecord,
) {
  const name = uniqueStrings([
    [contact.firstName, contact.lastName].filter(Boolean).join(" "),
  ])[0] || null;

  const rowMap = new Map<string, string | null>();
  const valuesByHeader: Record<string, string | null> = {
    "Data": pickActiveCampaignSheetDate(payload),
    "Nome": name,
    "Email": nonEmptyString(payload["contact[email]"]) || contact.email,
    "Telefone": normalizeBrazilianPhone(contact.phone) || contact.phone,
    "Tipo de Lead":
      normalizeLeadTypeForSheets(payload.tipo_de_lead) ||
      normalizeLeadTypeForSheets(payload.lead_type) ||
      normalizeLeadTypeForSheets(payload.tipo) ||
      "Lead",
    "Produto":
      nonEmptyString(payload.produto) ||
      nonEmptyString(payload.product) ||
      nonEmptyString(payload.product_name) ||
      nonEmptyString(launch.gs_default_product_name) ||
      launch.name,
    "UTM SOURCE": nonEmptyString(payload.utm_source),
    "UTM CAMPAIGN": nonEmptyString(payload.utm_campaign),
    "UTM MEDIUM": nonEmptyString(payload.utm_medium),
    "UTM CONTENT": nonEmptyString(payload.utm_content),
    "UTM TERM": nonEmptyString(payload.utm_term),
    "UTM SITE": nonEmptyString(payload.utm_site),
    "Data do Cadastro": pickActiveCampaignRegistrationDate(payload),
    "Vlr Dash": nonEmptyString(payload.dashboard_value) || "1",
    "HOTLEAD": nonEmptyString(payload.hotlead),
    "vk_source": nonEmptyString(payload.vk_source),
    "vk_ad_id": nonEmptyString(payload.vk_ad_id),
  };

  for (const [header, value] of Object.entries(valuesByHeader)) {
    rowMap.set(normalizeColumnKey(header), value);
  }

  return rowMap;
}

function pickCaptureColumnValueFromCsv(row: JsonRecord, sheetColumn: string) {
  const normalizedColumn = normalizeColumnKey(sheetColumn);
  const aliases = CSV_CAPTURE_COLUMN_ALIASES[normalizedColumn] ?? [sheetColumn];
  return firstStringFromAnyRowColumn(row, aliases);
}

function buildActiveCsvSheetsRowMap(
  launch: LaunchGoogleSheetsRow,
  contact: ActiveCampaignContact,
  row: JsonRecord,
) {
  const rowMap = new Map<string, string | null>();

  for (const header of STANDARD_CAPTURE_HEADER) {
    const value = pickCaptureColumnValueFromCsv(row, header);
    if (value) rowMap.set(normalizeColumnKey(header), value);
  }

  const createdAt = pickCreatedAtFromCsvRow(row);
  const product =
    pickCaptureColumnValueFromCsv(row, "Produto") ||
    nonEmptyString(launch.gs_default_product_name) ||
    launch.name;

  const defaultsByHeader: Record<string, string | null> = {
    "Data": formatSheetDate(pickCaptureColumnValueFromCsv(row, "Data")) || todaySheetDate(),
    "Nome": pickNameFromCsvRow(row),
    "Email": contact.email,
    "Telefone": normalizeBrazilianPhone(contact.phone) || contact.phone,
    "Tipo de Lead": normalizeLeadTypeForSheets(pickCaptureColumnValueFromCsv(row, "Tipo de Lead")) || "Lead",
    "Produto": product,
    "Data do Cadastro": formatSheetDate(createdAt) || formatSheetDate(pickCaptureColumnValueFromCsv(row, "Data do Cadastro")),
    "Vlr Dash": pickCaptureColumnValueFromCsv(row, "Vlr Dash") || "1",
  };

  for (const [header, value] of Object.entries(defaultsByHeader)) {
    const key = normalizeColumnKey(header);
    if (!rowMap.get(key) && value) rowMap.set(key, value);
  }

  return rowMap;
}

function buildRowForSheetHeader(
  sheetHeader: string[],
  rowMap: Map<string, string | null>,
) {
  const fallbackHeader = sheetHeader.length > 0 ? sheetHeader : STANDARD_CAPTURE_HEADER;
  return fallbackHeader.map((header) => rowMap.get(normalizeColumnKey(header)) ?? "");
}

function isUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  const message = `${typeof record.message === "string" ? record.message : ""} ${typeof record.details === "string" ? record.details : ""}`;
  return code === "23505" || /duplicate key|unique constraint/i.test(message);
}

async function saveCaptureRecord(
  supabase: AnySupabaseClient,
  launch: LaunchGoogleSheetsRow,
  contact: ActiveCampaignContact,
  spreadsheetId: string,
  sheetName: string,
  source: string,
) {
  const { error } = await supabase
    .from("launch_google_sheet_capture_records")
    .insert({
      launch_id: launch.id,
      cycle_number: launch.current_cycle_number || 1,
      active_contact_id: contact.id,
      primary_email: contact.email,
      normalized_phone: normalizeBrazilianPhone(contact.phone),
      phone_dedupe_key: buildPhoneDedupeKey(contact.phone),
      spreadsheet_id: spreadsheetId,
      sheet_name: sheetName,
      row_fingerprint: buildCaptureFingerprint(contact),
      source,
      append_status: "appended",
    });

  if (error && !isUniqueViolation(error)) {
    throw new Error(error.message);
  }
}

function normalizeMappings(rawMappings: CsvMapping[] | null | undefined) {
  const mappings = Array.isArray(rawMappings) ? rawMappings : [];
  const uniqueByTarget = new Map<string, NormalizedCsvMapping>();

  for (const mapping of mappings) {
    const value = nonEmptyString(mapping?.value) ?? nonEmptyString(mapping?.staticValue);
    const csvColumn = nonEmptyString(mapping?.csvColumn);
    const sheetColumn = nonEmptyString(mapping?.sheetColumn);
    if ((!value && !csvColumn) || !sheetColumn) continue;

    uniqueByTarget.set(normalizeColumnKey(sheetColumn), {
      value,
      csvColumn,
      sheetColumn,
    });
  }

  return [...uniqueByTarget.values()].slice(0, MAX_MAPPINGS_PER_REQUEST);
}

function resolveMappingValue(mapping: NormalizedCsvMapping, row: JsonRecord) {
  if (mapping.value !== null) return mapping.value;
  return mapping.csvColumn ? firstStringFromRow(row, mapping.csvColumn) : "";
}

function buildHeaderIndex(headerRow: unknown[]) {
  const index = new Map<string, number>();

  headerRow.forEach((value, columnIndex) => {
    const key = normalizeColumnKey(value);
    if (key && !index.has(key)) {
      index.set(key, columnIndex);
    }
  });

  return index;
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

  try {
    const body = await request.json() as BulkUpdateBody;
    const launchId = nonEmptyString(body.launchId);
    const emailColumn = nonEmptyString(body.emailColumn);
    const mode = body.mode === "active_export_import" ? "active_export_import" : "fixed_update";
    const isActiveCsvImport = mode === "active_export_import";
    const mappings = normalizeMappings(body.mappings);
    const rows = Array.isArray(body.rows) ? body.rows.filter(isRecord).slice(0, MAX_ROWS_PER_REQUEST) : [];
    const skipBlankValues = body.skipBlankValues !== false;

    if (!launchId) throw new ProcessContactError("launchId is required", 400);
    if (!emailColumn) throw new ProcessContactError("emailColumn is required", 400);
    if (!isActiveCsvImport && mappings.length === 0) {
      throw new ProcessContactError("At least one column mapping is required", 400);
    }
    if (rows.length === 0) throw new ProcessContactError("No CSV rows were provided", 400);

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authenticatedUser = await requireAuthenticatedUser(request, supabaseUrl, serviceRoleKey);
    await assertLaunchAccess(supabase, authenticatedUser.id, launchId);

    const launch = await fetchLaunchGoogleSheetsConfig(supabase, launchId);
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
      throw new ProcessContactError("Google Sheets is not configured for this expert", 400);
    }

    const sheetValuesResult = await readGoogleSheetsValues(config, "A:Q");
    if (sheetValuesResult.skipped) {
      throw new ProcessContactError("Google Sheets is not configured for this expert", 400);
    }

    const sheetValues = sheetValuesResult.values;
    const header = sheetValues[0] ?? [];
    const headerIndex = buildHeaderIndex(header);
    const emailColumnIndex = headerIndex.get("email");
    const phoneColumnIndex = findHeaderColumnIndex(headerIndex, SHEET_PHONE_COLUMNS);

    if (emailColumnIndex === undefined) {
      throw new ProcessContactError("The selected sheet does not have an Email column", 400);
    }

    const mappingTargets = isActiveCsvImport ? [] : mappings.map((mapping) => ({
      ...mapping,
      targetIndex: headerIndex.get(normalizeColumnKey(mapping.sheetColumn)),
    }));
    const missingSheetColumns = mappingTargets
      .filter((mapping) => mapping.targetIndex === undefined)
      .map((mapping) => mapping.sheetColumn);

    if (missingSheetColumns.length > 0) {
      throw new ProcessContactError(
        "Some target columns do not exist in the selected sheet",
        400,
        JSON.stringify({ missingSheetColumns }),
      );
    }

    const sheetRowByEmail = new Map<string, number>();
    const sheetRowByPhoneKey = new Map<string, number>();
    for (let rowIndex = 1; rowIndex < sheetValues.length; rowIndex += 1) {
      const row = sheetValues[rowIndex] ?? [];
      const email = normalizeEmail(row[emailColumnIndex]);
      if (email && !sheetRowByEmail.has(email)) {
        sheetRowByEmail.set(email, rowIndex + 1);
      }

      if (phoneColumnIndex !== undefined) {
        const phoneKey = buildPhoneDedupeKey(row[phoneColumnIndex]);
        if (phoneKey && !sheetRowByPhoneKey.has(phoneKey)) {
          sheetRowByPhoneKey.set(phoneKey, rowIndex + 1);
        }
      }
    }

    const csvRowByIdentity = new Map<string, {
      email: string | null;
      row: JsonRecord;
      name: string | null;
      phone: string | null;
      phoneDedupeKey: string | null;
    }>();
    const emailIdentityKeys = new Map<string, string>();
    const phoneIdentityKeys = new Map<string, string>();
    const uniqueEmailSet = new Set<string>();
    let missingIdentityRows = 0;
    let missingEmailRows = 0;
    let duplicatedInputIdentities = 0;
    let duplicatedInputEmails = 0;

    for (const row of rows) {
      const email = normalizeEmail(firstStringFromRow(row, emailColumn));
      if (!email) {
        missingEmailRows += 1;
      }

      const phone = pickPhoneFromCsvRow(row);
      const phoneDedupeKey = buildPhoneDedupeKey(phone);
      const existingIdentityKey =
        email
          ? emailIdentityKeys.get(email)
          : phoneDedupeKey
          ? phoneIdentityKeys.get(phoneDedupeKey)
          : undefined;

      if (email) uniqueEmailSet.add(email);

      if (email && emailIdentityKeys.has(email)) {
        duplicatedInputEmails += 1;
      }

      if (existingIdentityKey) {
        duplicatedInputIdentities += 1;
        continue;
      }

      const identityKey = email ? `email:${email}` : phoneDedupeKey ? `phone:${phoneDedupeKey}` : "";
      if (!identityKey) {
        missingIdentityRows += 1;
        continue;
      }

      csvRowByIdentity.set(identityKey, {
        email,
        row,
        name: pickNameFromCsvRow(row),
        phone,
        phoneDedupeKey,
      });
      if (email) emailIdentityKeys.set(email, identityKey);
      if (!email && phoneDedupeKey) phoneIdentityKeys.set(phoneDedupeKey, identityKey);
    }

    const sheetHeader = header.map((value) => nonEmptyString(value) ?? "");
    const updates: Array<{ range: string; values: string[][] }> = [];
    const rowsMissingFromSheet: Array<{
      email: string | null;
      row: JsonRecord;
      name: string | null;
      phone: string | null;
      phoneDedupeKey: string | null;
    }> = [];
    const notFound: Array<{ email: string | null; name: string | null; phone: string | null; reason: string }> = [];
    const insertedFromActiveSamples: Array<{ email: string | null; activeContactId: string }> = [];
    let matchedRows = 0;
    let matchedByPhoneRows = 0;
    let updatedRows = 0;
    let skippedBlankCells = 0;
    let skippedUnchangedCells = 0;
    let insertedFromActive = 0;
    let activeContactsNotFound = 0;
    let activeContactsFoundByPhone = 0;
    let activeContactsWithoutCaptureTag = 0;
    let activeLookupErrors = 0;
    let activeCaptureTagMissing = 0;

    for (const item of csvRowByIdentity.values()) {
      const emailMatchedRowNumber = item.email ? sheetRowByEmail.get(item.email) : undefined;
      const phoneMatchedRowNumber = !item.email && item.phoneDedupeKey
        ? sheetRowByPhoneKey.get(item.phoneDedupeKey)
        : undefined;
      const sheetRowNumber = emailMatchedRowNumber ?? phoneMatchedRowNumber;
      if (!sheetRowNumber) {
        rowsMissingFromSheet.push(item);
        continue;
      }

      matchedRows += 1;
      if (!emailMatchedRowNumber && phoneMatchedRowNumber) {
        matchedByPhoneRows += 1;
      }

      let rowUpdated = false;
      const sheetRow = sheetValues[sheetRowNumber - 1] ?? [];

      if (isActiveCsvImport) {
        const activeContact = buildActiveCampaignContactFromCsvRow(item.email, item.row);
        const rowMap = buildActiveCsvSheetsRowMap(launch, activeContact, item.row);

        for (const [targetIndex, headerName] of sheetHeader.entries()) {
          const value = nonEmptyString(rowMap.get(normalizeColumnKey(headerName)));
          if (!value || !shouldFillBlankSheetCell(sheetRow[targetIndex], value)) continue;

          updates.push({
            range: `${columnLetters(targetIndex)}${sheetRowNumber}`,
            values: [[value]],
          });
          rowUpdated = true;
        }

        if (rowUpdated) {
          updatedRows += 1;
        }
        continue;
      }

      for (const mapping of mappingTargets) {
        if (mapping.targetIndex === undefined) continue;
        const value = resolveMappingValue(mapping, item.row);

        if (skipBlankValues && !value) {
          skippedBlankCells += 1;
          continue;
        }

        if (!shouldUpdateSheetCell(sheetRow[mapping.targetIndex], value)) {
          skippedUnchangedCells += 1;
          continue;
        }

        updates.push({
          range: `${columnLetters(mapping.targetIndex)}${sheetRowNumber}`,
          values: [[value]],
        });
        rowUpdated = true;
      }

      if (rowUpdated) {
        updatedRows += 1;
      }
    }

    const rowsToAppend: string[][] = [];
    const captureRecordsToSave: ActiveCampaignContact[] = [];
    const activeCaptureTag = !isActiveCsvImport && rowsMissingFromSheet.length > 0 ? await resolveCaptureTag(launch) : null;
    const fieldDefinitions =
      !isActiveCsvImport && rowsMissingFromSheet.length > 0 && activeCaptureTag
        ? await loadActiveCampaignFieldDefinitions(launch)
        : [];

    for (const item of rowsMissingFromSheet) {
      if (isActiveCsvImport) {
        const activeContact = buildActiveCampaignContactFromCsvRow(item.email, item.row);
        const rowMap = buildActiveCsvSheetsRowMap(launch, activeContact, item.row);

        rowsToAppend.push(buildRowForSheetHeader(sheetHeader, rowMap));
        captureRecordsToSave.push(activeContact);
        insertedFromActiveSamples.push({
          email: item.email,
          activeContactId: activeContact.id,
        });
        continue;
      }

      if (!activeCaptureTag) {
        activeCaptureTagMissing += 1;
        notFound.push({
          email: item.email,
          name: item.name,
          phone: item.phone,
          reason: "capture_tag_not_configured",
        });
        continue;
      }

      try {
        let activeContact = item.email ? await fetchActiveCampaignContactByEmail(launch, item.email) : null;
        if (!activeContact && item.phone) {
          activeContact = await fetchActiveCampaignContactByPhone(launch, item.phone);
          if (activeContact) {
            activeContactsFoundByPhone += 1;
          }
        }

        if (!activeContact) {
          activeContactsNotFound += 1;
          notFound.push({
            email: item.email,
            name: item.name,
            phone: item.phone,
            reason: "active_contact_not_found",
          });
          continue;
        }

        const hasCaptureTag = await activeCampaignContactHasTag(launch, activeContact.id, activeCaptureTag.id);
        if (!hasCaptureTag) {
          activeContactsWithoutCaptureTag += 1;
          notFound.push({
            email: item.email,
            name: item.name,
            phone: item.phone,
            reason: "active_contact_without_capture_tag",
          });
          continue;
        }

        const fieldPayload = await fetchContactFieldPayload(launch, fieldDefinitions, activeContact.id);
        const rowMap = buildActiveCampaignSheetsRowMap(
          launch,
          activeContact,
          buildContactPayload(activeContact, fieldPayload),
        );

        for (const mapping of mappingTargets) {
          const value = resolveMappingValue(mapping, item.row);
          if (skipBlankValues && !value) continue;
          rowMap.set(normalizeColumnKey(mapping.sheetColumn), value);
        }

        rowsToAppend.push(buildRowForSheetHeader(sheetHeader, rowMap));
        captureRecordsToSave.push(activeContact);
        insertedFromActiveSamples.push({
          email: item.email,
          activeContactId: activeContact.id,
        });
      } catch (error) {
        activeLookupErrors += 1;
        notFound.push({
          email: item.email,
          name: item.name,
          phone: item.phone,
          reason: error instanceof Error ? `active_lookup_error: ${error.message}` : "active_lookup_error",
        });
      }
    }

    if (updates.length > MAX_SHEET_UPDATES_PER_REQUEST) {
      throw new ProcessContactError(
        "Too many cells to update in a single request",
        413,
        JSON.stringify({
          updates: updates.length,
          limit: MAX_SHEET_UPDATES_PER_REQUEST,
        }),
      );
    }

    const updateResult = await updateGoogleSheetsRanges(config, updates);
    const appendResult = rowsToAppend.length > 0
      ? await appendGoogleSheetsRows(config, sheetHeader.length > 0 ? sheetHeader : STANDARD_CAPTURE_HEADER, rowsToAppend)
      : { skipped: true, reason: "no_missing_rows_eligible_for_append" } as const;
    if (!appendResult.skipped) {
      insertedFromActive = rowsToAppend.length;
      for (const contact of captureRecordsToSave) {
        await saveCaptureRecord(
          supabase,
          launch,
          contact,
          config.spreadsheetId,
          config.sheetName,
          isActiveCsvImport ? "active_csv_import" : "csv_bulk_update",
        );
      }
    }
    const summary = {
      mode,
      receivedRows: rows.length,
      uniqueIdentities: csvRowByIdentity.size,
      uniqueEmails: uniqueEmailSet.size,
      missingIdentityRows,
      missingEmailRows,
      duplicatedInputIdentities,
      duplicatedInputEmails,
      matchedRows,
      matchedByPhoneRows,
      updatedRows,
      updatedCells: updates.length,
      missingFromSheetRows: rowsMissingFromSheet.length,
      insertedFromActive,
      insertedFromCsv: isActiveCsvImport ? insertedFromActive : 0,
      activeContactsNotFound,
      activeContactsFoundByPhone,
      activeContactsWithoutCaptureTag,
      activeLookupErrors,
      activeCaptureTagMissing,
      notFoundRows: notFound.length,
      skippedBlankCells,
      skippedUnchangedCells,
      sheetName: config.sheetName,
      spreadsheetId: config.spreadsheetId,
      captureTagId: activeCaptureTag?.id ?? null,
      captureTagName: activeCaptureTag?.name ?? null,
      mappings,
      skipBlankValues,
    };

    try {
      await insertContactLogs(supabase, [
        {
          launch_id: launch.id,
          source: "sheets",
          level: notFound.length > 0 ? "warning" : "success",
          code: "GOOGLE_SHEETS_BULK_UPDATE_COMPLETED",
          title: "Atualizacao em lote concluida",
          message:
            isActiveCsvImport
              ? "O CSV exportado do ActiveCampaign foi comparado com a captura; contatos ausentes foram inseridos diretamente com os dados do arquivo."
              : notFound.length > 0
              ? "O CSV foi processado; pessoas ausentes foram buscadas no ActiveCampaign e apenas elegiveis pela tag de captura foram inseridas."
              : "O CSV foi processado; as pessoas encontradas foram atualizadas e os ausentes elegiveis foram inseridos pela base do ActiveCampaign.",
          details: {
            ...summary,
            notFoundSample: notFound.slice(0, 20),
            insertedFromActiveSample: insertedFromActiveSamples.slice(0, 20),
            updateSkipped: updateResult.skipped,
            appendSkipped: appendResult.skipped,
          },
          cycle_number: launch.current_cycle_number,
        },
      ]);
    } catch (logError) {
      console.warn(
        "google-sheets-bulk-update completed but failed to insert logs",
        logError instanceof Error ? logError.message : String(logError),
      );
    }

    return jsonResponse({
      success: true,
      summary,
      notFound,
      updateSkipped: updateResult.skipped,
      appendSkipped: appendResult.skipped,
    });
  } catch (error) {
    if (error instanceof ProcessContactError) {
      return jsonResponse({ error: error.message, details: error.details ?? null }, error.statusCode);
    }

    console.error("google-sheets-bulk-update failed", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected Google Sheets bulk update error" },
      500,
    );
  }
});

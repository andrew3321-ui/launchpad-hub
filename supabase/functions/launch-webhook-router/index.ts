// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ProcessContactError,
  processIncomingContactEvent,
  type IncomingEventBody,
} from "../_shared/contact-processing.ts";

type JsonRecord = Record<string, unknown>;
type AnySupabaseClient = ReturnType<typeof createClient>;
type WebhookSource = "activecampaign" | "manychat" | "typebot" | "sendflow" | "uchat";

interface LaunchRow {
  id: string;
  slug: string | null;
  name: string;
  webhook_secret: string;
  ac_api_url: string | null;
  ac_api_key: string | null;
  ac_default_list_id: string | null;
  ac_named_tags: unknown;
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

interface RouteToUchatOptions {
  allowSubflow?: boolean;
  allowTag?: boolean;
  requireExplicitRecipient?: boolean;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ROUTING_PENDING_TIMEOUT_MS = 5 * 60 * 1000;

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

function extractGenericContact(payload: JsonRecord) {
  const name =
    findStringDeep(payload, ["name", "full_name", "fullname"]) ||
    uniqueStrings([
      findStringDeep(payload, ["first_name", "firstname", "first"]),
      findStringDeep(payload, ["last_name", "lastname", "last"]),
    ]).join(" ") ||
    null;

  return {
    name,
    email: findStringDeep(payload, ["email"]),
    phone:
      findStringDeep(payload, ["phone", "telephone", "whatsapp", "mobile", "cellphone", "number"]) ||
      null,
  };
}

function normalizeWebhookSource(value: string | null) {
  if (!value) return null;
  const normalized = normalizeKey(value);

  if (normalized === "activecampaign") return "activecampaign";
  if (normalized === "manychat") return "manychat";
  if (normalized === "typebot") return "typebot";
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
    throw new Error(`HTTP ${response.status}: ${rawText}`);
  }

  return parsed;
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
  return collectStringListDeep(payload, ["tags", "tag", "tag_name"]);
}

function extractTagAliases(payload: JsonRecord) {
  return uniqueStrings([
    ...collectStringListDeep(payload, ["tag_aliases", "tag_alias", "state", "states", "status"]),
    findStringDeep(payload, ["event_type", "event"]),
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

function resolveActiveCampaignTags(payload: JsonRecord, namedTags: NamedTag[]) {
  const directTags = extractTagNames(payload);
  const aliases = extractTagAliases(payload).map(normalizeKey);
  const mappedTags = namedTags
    .filter((item) => aliases.includes(normalizeKey(item.alias)))
    .map((item) => item.tag);

  return uniqueStrings([...directTags, ...mappedTags]);
}

async function fetchLaunch(
  supabase: AnySupabaseClient,
  launchId: string | null,
  launchSlug: string | null,
) {
  const query = launchId
    ? supabase
        .from("launches")
        .select("id, slug, name, webhook_secret, ac_api_url, ac_api_key, ac_default_list_id, ac_named_tags")
        .eq("id", launchId)
    : supabase
        .from("launches")
        .select("id, slug, name, webhook_secret, ac_api_url, ac_api_key, ac_default_list_id, ac_named_tags")
        .eq("slug", launchSlug as string);

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    throw new ProcessContactError("Launch not found", 404, error?.message);
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

  if ((existing as { id?: string } | null)?.id) {
    await supabase
      .from("lead_contact_identities")
      .update({
        contact_id: contactId,
        external_email: email,
        external_phone: phone,
        normalized_phone: phone,
        raw_snapshot: rawSnapshot,
      } as Record<string, unknown>)
      .eq("id", (existing as { id: string }).id);
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

  return tags;
}

async function resolveActiveCampaignTagId(
  launch: LaunchRow,
  tagLabel: string,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) {
    throw new ProcessContactError("ActiveCampaign is not configured for this launch", 400);
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

  return createdId;
}

async function syncContactToActiveCampaign(
  launch: LaunchRow,
  contact: LeadContactRow,
  tagNames: string[],
) {
  if (!launch.ac_api_url || !launch.ac_api_key) {
    throw new ProcessContactError("ActiveCampaign is not configured for this launch", 400);
  }

  if (!contact.primary_email && !contact.primary_phone) {
    throw new ProcessContactError("The contact does not have email or phone to send to ActiveCampaign", 400);
  }

  const { firstName, lastName } = splitName(contact.primary_name);
  const payload = await activeCampaignRequest(
    launch.ac_api_url,
    launch.ac_api_key,
    "/api/3/contact/sync",
    "POST",
    {
      contact: {
        email: contact.primary_email || undefined,
        phone: contact.primary_phone || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
      },
    },
  );

  const syncedContact = isRecord((payload as JsonRecord).contact) ? ((payload as JsonRecord).contact as JsonRecord) : {};
  const activeContactId = nonEmptyString(syncedContact.id);

  if (!activeContactId) {
    throw new ProcessContactError("ActiveCampaign did not return the synced contact id", 500);
  }

  if (launch.ac_default_list_id) {
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
  }

  const appliedTags: string[] = [];
  for (const tagName of uniqueStrings(tagNames)) {
    const tagId = await resolveActiveCampaignTagId(launch, tagName);
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
    appliedTags.push(tagName);
  }

  return {
    activeContactId,
    appliedTags,
  };
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

async function findExistingActiveCampaignContact(
  launch: LaunchRow,
  contact: LeadContactRow,
  knownContactId?: string | null,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) {
    return null;
  }

  if (knownContactId) {
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

  if (contact.primary_email) {
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

  const phoneCandidates = uniqueStrings([
    contact.primary_phone,
    contact.normalized_phone,
    contact.primary_phone?.replace(/\D/g, "") || null,
  ]);

  for (const phoneCandidate of phoneCandidates) {
    const payload = await activeCampaignRequest(
      launch.ac_api_url,
      launch.ac_api_key,
      "/api/3/contacts",
      "GET",
      undefined,
      { phone: phoneCandidate },
    );

    const matchedContact = extractActiveCampaignContact(payload);
    const activeContactId = nonEmptyString(matchedContact?.id);
    if (matchedContact && activeContactId) {
      return {
        matchedBy: "phone",
        activeContactId,
        snapshot: matchedContact,
      };
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
) {
  const explicitContact = extractGenericContact(payload);

  if (!explicitContact.phone && !explicitContact.email) {
    throw new ProcessContactError(
      "Relay webhook requires explicit phone or email to create the UChat subscriber precisely",
      400,
    );
  }

  const { firstName, lastName } = splitName(explicitContact.name);
  const created = await uchatRequest(workspace.api_token, "/subscriber/create", "POST", {
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    name: explicitContact.name || undefined,
    phone: explicitContact.phone || undefined,
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
    const phoneMatch = await fetchUchatSubscriberByQuery(workspace, {
      phone: explicitContact.phone,
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

  if (explicitContact.phone || explicitContact.email) {
    return await createUchatSubscriberFromExplicitPayload(workspace, payload);
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

  return {
    workspace,
    userNs: subscriber.userNs,
    userId: subscriber.userId,
    snapshot: subscriber.snapshot,
    currentTags: extractUchatSubscriberTags(subscriber.snapshot),
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
    throw new ProcessContactError("No valid UChat workspace configured for this launch", 400);
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

  const subflowNs =
    options.allowSubflow === false
      ? null
      : findStringDeep(payload, ["subflow_ns", "subflow", "welcome_subflow_ns"]) ||
        nonEmptyString(workspace.welcome_subflow_ns);
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
  const tagNames = resolveActiveCampaignTags(payload, parseNamedTags(launch.ac_named_tags));

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
      tags: tagNames,
      listId: launch.ac_default_list_id,
    },
  );

  if (!actionId) {
    return {
      target: "activecampaign",
      skipped: true,
    };
  }

  try {
    const response = await syncContactToActiveCampaign(launch, contact, tagNames);

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
        applied_tags: response.appliedTags,
      },
    );

    await updateRoutingAction(supabase, actionId, "success", response as unknown as JsonRecord);
    return {
      target: "activecampaign",
      contactId: response.activeContactId,
      tagsApplied: response.appliedTags,
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
      "Contato ja possui as tags do lancamento",
      "O evento vindo do ActiveCampaign ja chegou com tags do lancamento. Mesmo assim, o Launch Hub continuou o retorno para o UChat porque esse webhook pode ser usado como gatilho explicito do subflow.",
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
          "O contato seguiu para o subflow do UChat sem consulta ao ActiveCampaign porque faltava configuracao ou dado minimo de busca.",
          activeVerification as unknown as JsonRecord,
        );
      } else if (activeVerification.matched) {
        await insertProcessingLog(
          supabase,
          launch.id,
          contact.id,
          eventId,
          normalizedEvent.source,
          "success",
          "ACTIVECAMPAIGN_DUPLICATE_LINKED",
          "Contato ja existia no ActiveCampaign",
          "O Launch Hub encontrou um contato compativel no ActiveCampaign, vinculou a identidade existente e continuou o retorno para o subflow do UChat.",
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
          "O Launch Hub consultou o ActiveCampaign, nao encontrou um contato correspondente e seguiu com o subflow do UChat.",
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
        "A verificacao de duplicidade no ActiveCampaign falhou, mas o Launch Hub manteve o retorno para o subflow do UChat.",
        { error: message },
      );
    }

    const uchatReturn = await routeToUchat(
      supabase,
      launch,
      contact,
      eventId,
      normalizedEvent.source,
      routingPayload,
      {
        allowSubflow: true,
        allowTag: false,
      },
    );

    await insertProcessingLog(
      supabase,
      launch.id,
      contact.id,
      eventId,
      normalizedEvent.source,
      "success",
      "ROUTED_BACK_TO_UCHAT_SUBFLOW",
      "Contato retornou ao UChat",
      "Depois da verificacao no ActiveCampaign, o Launch Hub reenviou o contato ao UChat apenas para o subflow de boas-vindas.",
      {
        ...(activeVerification ? { activeVerification } : {}),
        uchatReturn,
      } as JsonRecord,
    );

    return {
      checkedActiveCampaign: activeVerification,
      returnedToUchat: true,
      uchatReturn,
    };
  }

  if (["manychat", "typebot"].includes(normalizedEvent.source)) {
    const routed = await routeToActiveCampaign(
      supabase,
      launch,
      contact,
      eventId,
      normalizedEvent.source,
      routingPayload,
    );

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

    return routed;
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
        "O Launch Hub encaminhou o contato tratado para o UChat com a acao configurada do lancamento.",
        routed as unknown as JsonRecord,
      );

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
        },
      );
      throw error;
    }
  }

  return { skipped: true, reason: "no_route_defined" };
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
  const source = normalizeWebhookSource(url.searchParams.get("source"));
  const launchId = nonEmptyString(url.searchParams.get("launchId"));
  const launchSlug = nonEmptyString(url.searchParams.get("launchSlug"));
  const token = nonEmptyString(url.searchParams.get("token"));

  if (!source) {
    return jsonResponse({ error: "Missing or invalid source" }, 400);
  }

  if (!launchId && !launchSlug) {
    return jsonResponse({ error: "launchId or launchSlug is required" }, 400);
  }

  try {
    const payload = await parseRequestBody(request);
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const launch = await fetchLaunch(supabase, launchId, launchSlug);

    if (!token || token !== launch.webhook_secret) {
      return jsonResponse({ error: "Invalid webhook token" }, 403);
    }

    const normalizedEvent = normalizeIncomingWebhook(source, payload);

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

    const routingResult = await dispatchRoutes(
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

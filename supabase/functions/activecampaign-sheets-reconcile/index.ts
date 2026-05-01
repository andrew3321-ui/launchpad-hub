// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  appendGoogleSheetsRows,
  parseGoogleSheetsConfig,
  readGoogleSheetsValues,
} from "../_shared/google-sheets.ts";

type AnySupabaseClient = ReturnType<typeof createClient>;
type JsonRecord = Record<string, unknown>;

interface LaunchRow {
  id: string;
  slug: string | null;
  name: string;
  ac_api_url: string | null;
  ac_api_key: string | null;
  current_cycle_number: number;
  gs_enabled: boolean;
  gs_auth_mode: "service_account" | "oauth" | null;
  gs_oauth_refresh_token: string | null;
  gs_service_account_email: string | null;
  gs_private_key: string | null;
  gs_spreadsheet_id: string | null;
  gs_sheet_name: string | null;
  gs_capture_tag_id: string | null;
  gs_capture_tag_name: string | null;
  gs_default_product_name: string | null;
}

interface ReconcileStateRow {
  launch_id: string;
  tag_id: string | null;
  tag_name: string | null;
  next_offset: number | null;
}

interface ActiveCampaignContact {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
}

interface ActiveCampaignFieldDefinition {
  id: string;
  keys: string[];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-launchhub-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_BATCH_LIMIT = 500;
const MAX_BATCH_LIMIT = 500;
const ACTIVE_CAMPAIGN_RETRIES = 2;
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
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function digitsOnly(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeBrazilianPhone(value: unknown) {
  const digits = digitsOnly(value);
  if (!digits) return null;
  if (digits.startsWith("55")) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function normalizeActiveCampaignBaseUrl(apiUrl: string) {
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/3") ? trimmed.slice(0, -6) : trimmed;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= ACTIVE_CAMPAIGN_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Api-Token": apiKey,
        },
      });

      if (response.ok) return await response.json();

      const text = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < ACTIVE_CAMPAIGN_RETRIES) {
        await delay(500 * (attempt + 1));
        continue;
      }

      throw new Error(`HTTP ${response.status}: ${text}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < ACTIVE_CAMPAIGN_RETRIES) {
        await delay(500 * (attempt + 1));
      }
    }
  }

  throw lastError || new Error("Unknown ActiveCampaign request error");
}

async function loadActiveCampaignTags(launch: LaunchRow) {
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

async function resolveCaptureTag(launch: LaunchRow) {
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
  const match = tags.find((tag) => normalizeKey(tag.tag) === normalizeKey(tagName));

  return match ? { id: match.id, name: match.tag } : null;
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
  };
}

async function fetchContactsByTag(launch: LaunchRow, tagId: string, offset: number, limit: number) {
  if (!launch.ac_api_url || !launch.ac_api_key) return [] as ActiveCampaignContact[];

  const payload = await activeCampaignRequest(launch.ac_api_url, launch.ac_api_key, "/api/3/contacts", {
    tagid: tagId,
    limit,
    offset,
  });
  const contacts = Array.isArray((payload as JsonRecord).contacts)
    ? ((payload as JsonRecord).contacts as unknown[])
    : [];

  return contacts
    .map(parseActiveCampaignContact)
    .filter((contact): contact is ActiveCampaignContact => Boolean(contact));
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
    .map(normalizeKey)
    .filter(Boolean);

  return [...new Set(keys)];
}

async function loadActiveCampaignFieldDefinitions(launch: LaunchRow) {
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
    const normalizedAliases = aliases.map(normalizeKey);
    if (definition.keys.some((key) => normalizedAliases.includes(key))) {
      return targetKey;
    }
  }

  return null;
}

async function fetchContactFieldPayload(
  launch: LaunchRow,
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

function getActiveCampaignBodyValue(payload: JsonRecord, key: string) {
  const value = payload[key];
  return nonEmptyString(value);
}

function getActiveCampaignContactField(payload: JsonRecord, fieldName: string) {
  return nonEmptyString(payload[fieldName]);
}

function buildContactName(contact: ActiveCampaignContact) {
  return uniqueStrings([[contact.firstName, contact.lastName].filter(Boolean).join(" ")])[0] || null;
}

function formatGoogleSheetsPhone(contact: ActiveCampaignContact) {
  return normalizeBrazilianPhone(contact.phone) || contact.phone;
}

function buildActiveCampaignSheetsRow(
  launch: LaunchRow,
  contact: ActiveCampaignContact,
  payload: JsonRecord,
) {
  const name = uniqueStrings([
    [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    buildContactName(contact),
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
      getActiveCampaignBodyValue(payload, "contact[email]") || contact.email,
      formatGoogleSheetsPhone(contact),
      getActiveCampaignContactField(payload, "tipo_de_lead"),
      getActiveCampaignContactField(payload, "produto") || launch.gs_default_product_name,
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
  };
}

function buildContactPayload(contact: ActiveCampaignContact, fieldPayload: JsonRecord) {
  return {
    ...fieldPayload,
    "contact[id]": contact.id,
    "contact[email]": contact.email,
    "contact[phone]": contact.phone,
    "contact[first_name]": contact.firstName,
    "contact[last_name]": contact.lastName,
  } satisfies JsonRecord;
}

function buildCaptureFingerprint(contact: ActiveCampaignContact) {
  const email = contact.email ? `email:${contact.email.toLowerCase()}` : null;
  const phone = normalizeBrazilianPhone(contact.phone);
  return normalizeKey(contact.id || email || phone || "");
}

function buildSheetIndex(values: unknown[][]) {
  const emails = new Set<string>();
  const phones = new Set<string>();

  for (const row of values) {
    const email = nonEmptyString(row[0])?.toLowerCase();
    const phone = normalizeBrazilianPhone(row[1]);
    if (email) emails.add(email);
    if (phone) phones.add(phone);
  }

  return { emails, phones };
}

async function loadSheetIndex(launch: LaunchRow) {
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
    return { configured: false, emails: new Set<string>(), phones: new Set<string>() };
  }

  const result = await readGoogleSheetsValues(config, "C2:D");
  if (result.skipped) {
    return { configured: false, emails: new Set<string>(), phones: new Set<string>() };
  }

  return {
    configured: true,
    ...buildSheetIndex(result.values),
  };
}

function contactAlreadyInSheet(
  contact: ActiveCampaignContact,
  sheetIndex: { emails: Set<string>; phones: Set<string> },
) {
  const email = contact.email?.toLowerCase() || null;
  const phone = normalizeBrazilianPhone(contact.phone);
  return Boolean((email && sheetIndex.emails.has(email)) || (phone && sheetIndex.phones.has(phone)));
}

async function hasCaptureRecord(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  contact: ActiveCampaignContact,
) {
  const fingerprint = buildCaptureFingerprint(contact);
  const { data, error } = await supabase
    .from("launch_google_sheet_capture_records")
    .select("id")
    .eq("launch_id", launch.id)
    .eq("cycle_number", launch.current_cycle_number || 1)
    .eq("spreadsheet_id", launch.gs_spreadsheet_id)
    .eq("sheet_name", launch.gs_sheet_name)
    .eq("row_fingerprint", fingerprint)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

async function saveCaptureRecord(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  contact: ActiveCampaignContact,
  source: string,
) {
  await supabase
    .from("launch_google_sheet_capture_records")
    .upsert(
      {
        launch_id: launch.id,
        cycle_number: launch.current_cycle_number || 1,
        active_contact_id: contact.id,
        primary_email: contact.email,
        normalized_phone: normalizeBrazilianPhone(contact.phone),
        spreadsheet_id: launch.gs_spreadsheet_id,
        sheet_name: launch.gs_sheet_name,
        row_fingerprint: buildCaptureFingerprint(contact),
        source,
      },
      {
        onConflict: "launch_id,cycle_number,spreadsheet_id,sheet_name,row_fingerprint",
      },
    );
}

async function insertProcessingLog(
  supabase: AnySupabaseClient,
  launchId: string,
  level: "info" | "warning" | "error" | "success",
  code: string,
  title: string,
  message: string,
  details: JsonRecord = {},
) {
  await supabase.from("contact_processing_logs").insert({
    launch_id: launchId,
    source: "activecampaign",
    level,
    code,
    title,
    message,
    details,
  });
}

async function loadLaunches(supabase: AnySupabaseClient, launchId?: string | null) {
  let query = supabase
    .from("launches")
    .select("id, slug, name, ac_api_url, ac_api_key, current_cycle_number, gs_enabled, gs_auth_mode, gs_oauth_refresh_token, gs_service_account_email, gs_private_key, gs_spreadsheet_id, gs_sheet_name, gs_capture_tag_id, gs_capture_tag_name, gs_default_product_name")
    .eq("gs_enabled", true)
    .not("ac_api_url", "is", null)
    .not("ac_api_key", "is", null)
    .not("gs_spreadsheet_id", "is", null)
    .not("gs_sheet_name", "is", null);

  if (launchId) {
    query = query.eq("id", launchId);
  }

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return ((data || []) as LaunchRow[]).filter(
    (launch) => nonEmptyString(launch.gs_capture_tag_id) || nonEmptyString(launch.gs_capture_tag_name),
  );
}

async function loadState(supabase: AnySupabaseClient, launch: LaunchRow, tag: { id: string; name: string }) {
  const { data, error } = await supabase
    .from("launch_google_sheet_reconcile_state")
    .select("launch_id, tag_id, tag_name, next_offset")
    .eq("launch_id", launch.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const state = data as ReconcileStateRow | null;
  const sameTag = state?.tag_id === tag.id;

  return {
    offset: sameTag ? Math.max(0, Number(state?.next_offset || 0)) : 0,
  };
}

async function saveState(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  tag: { id: string; name: string },
  nextOffset: number,
  status: "success" | "failed",
  summary: JsonRecord,
  lastError?: string | null,
) {
  await supabase
    .from("launch_google_sheet_reconcile_state")
    .upsert(
      {
        launch_id: launch.id,
        tag_id: tag.id,
        tag_name: tag.name,
        next_offset: nextOffset,
        last_started_at: summary.startedAt,
        last_finished_at: new Date().toISOString(),
        last_status: status,
        last_error: lastError || null,
        last_run_summary: summary,
      },
      { onConflict: "launch_id" },
    );
}

async function reconcileLaunch(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  limit: number,
) {
  const startedAt = new Date().toISOString();
  const tag = await resolveCaptureTag(launch);
  if (!tag) {
    await insertProcessingLog(
      supabase,
      launch.id,
      "warning",
      "ACTIVE_SHEETS_CAPTURE_TAG_NOT_FOUND",
      "Tag de captura nao encontrada",
      "A revisao horaria do ActiveCampaign nao conseguiu resolver a tag configurada para este expert.",
      {
        configuredTagId: launch.gs_capture_tag_id,
        configuredTagName: launch.gs_capture_tag_name,
      },
    );
    return { launchId: launch.id, skipped: true, reason: "capture_tag_not_found" };
  }

  const state = await loadState(supabase, launch, tag);
  const sheetIndex = await loadSheetIndex(launch);
  if (!sheetIndex.configured) {
    return { launchId: launch.id, skipped: true, reason: "google_sheets_not_configured" };
  }

  const contacts = await fetchContactsByTag(launch, tag.id, state.offset, limit);
  const fieldDefinitions = contacts.length > 0 ? await loadActiveCampaignFieldDefinitions(launch) : [];
  const rowsToAppend: Array<{
    contact: ActiveCampaignContact;
    row: Array<string | number | boolean | null | undefined>;
  }> = [];
  let header: string[] | null = null;
  let batchAppendFailed = false;
  const counters = {
    fetched: contacts.length,
    appended: 0,
    skippedExisting: 0,
    skippedMissingIdentity: 0,
    errors: 0,
  };

  for (const contact of contacts) {
    try {
      if (!contact.email && !normalizeBrazilianPhone(contact.phone)) {
        counters.skippedMissingIdentity += 1;
        continue;
      }

      if (contactAlreadyInSheet(contact, sheetIndex) || await hasCaptureRecord(supabase, launch, contact)) {
        counters.skippedExisting += 1;
        continue;
      }

      const fieldPayload = await fetchContactFieldPayload(launch, fieldDefinitions, contact.id);
      const payload = buildContactPayload(contact, fieldPayload);
      const builtRow = buildActiveCampaignSheetsRow(launch, contact, payload);
      header = header ?? builtRow.header;
      rowsToAppend.push({ contact, row: builtRow.row });
    } catch (error) {
      counters.errors += 1;
      await insertProcessingLog(
        supabase,
        launch.id,
        "error",
        "ACTIVE_SHEETS_CAPTURE_CONTACT_FAILED",
        "Falha ao completar contato na planilha",
        "A revisao horaria encontrou o contato com a tag configurada, mas nao conseguiu enviar essa linha ao Google Sheets.",
        {
          activeContactId: contact.id,
          email: contact.email,
          phone: contact.phone,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  if (rowsToAppend.length > 0 && header) {
    try {
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
        throw new Error("Google Sheets configuration is incomplete.");
      }

      const result = await appendGoogleSheetsRows(
        config,
        header,
        rowsToAppend.map((item) => item.row),
      );

      if (!result.skipped) {
        for (const item of rowsToAppend) {
          await saveCaptureRecord(supabase, launch, item.contact, "activecampaign_hourly_reconcile");
          if (item.contact.email) sheetIndex.emails.add(item.contact.email.toLowerCase());
          const phone = normalizeBrazilianPhone(item.contact.phone);
          if (phone) sheetIndex.phones.add(phone);
        }

        counters.appended += rowsToAppend.length;
      }
    } catch (error) {
      batchAppendFailed = true;
      counters.errors += rowsToAppend.length;
      await insertProcessingLog(
        supabase,
        launch.id,
        "error",
        "ACTIVE_SHEETS_CAPTURE_BATCH_FAILED",
        "Falha ao enviar lote para a planilha",
        "A revisao horaria montou as linhas do ActiveCampaign, mas o envio em lote ao Google Sheets falhou.",
        {
          rowCount: rowsToAppend.length,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  const nextOffset = batchAppendFailed ? state.offset : contacts.length < limit ? 0 : state.offset + contacts.length;
  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    tagId: tag.id,
    tagName: tag.name,
    offset: state.offset,
    nextOffset,
    ...counters,
  };

  await saveState(supabase, launch, tag, nextOffset, "success", summary);

  if (contacts.length > 0 || counters.appended > 0) {
    await insertProcessingLog(
      supabase,
      launch.id,
      counters.errors > 0 ? "warning" : "success",
      "ACTIVE_SHEETS_CAPTURE_RECONCILED",
      "Revisao horaria ActiveCampaign -> Google Sheets concluida",
      "O Launch Hub procurou contatos com a tag de captura no ActiveCampaign e completou a planilha sem reenviar duplicados.",
      summary,
    );
  }

  return {
    launchId: launch.id,
    tag,
    ...summary,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = nonEmptyString(Deno.env.get("LAUNCHHUB_SYNC_CRON_SECRET"));
  const providedSecret = nonEmptyString(request.headers.get("x-launchhub-cron-secret"));
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return jsonResponse({ error: "Invalid cron secret" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
  }

  try {
    const body = (await request.json().catch(() => ({}))) as JsonRecord;
    const launchId = nonEmptyString(body.launchId);
    const limit = clampNumber(body.limit, DEFAULT_BATCH_LIMIT, 1, MAX_BATCH_LIMIT);
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const launches = await loadLaunches(supabase, launchId);
    const results = [];

    for (const launch of launches) {
      results.push(await reconcileLaunch(supabase, launch, limit));
    }

    return jsonResponse({
      ok: true,
      processedLaunches: results.length,
      results,
    });
  } catch (error) {
    console.error("activecampaign-sheets-reconcile failed", error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    );
  }
});

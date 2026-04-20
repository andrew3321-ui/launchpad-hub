// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
type AnySupabaseClient = ReturnType<typeof createClient>;
import {
  ProcessContactError,
  processIncomingContactEvent,
  type IncomingEventBody,
} from "../_shared/contact-processing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const activeCampaignPageSize = 100;
const uchatPageSize = 100;
const defaultActiveCampaignConcurrency = 5;
const defaultUchatConcurrency = 10;
const maxSampleErrors = 10;

type SyncSource = "activecampaign" | "uchat";
type JsonRecord = Record<string, unknown>;

interface SyncRequestBody {
  launchId?: string;
  launchSlug?: string;
  source: SyncSource;
  maxContacts?: number;
}

interface SyncCounters {
  fetchedCount: number;
  processedCount: number;
  createdCount: number;
  mergedCount: number;
  skippedCount: number;
  errorCount: number;
}

interface SyncRunRow {
  id: string;
}

interface LaunchRow {
  id: string;
  slug: string | null;
  name: string;
  ac_api_url: string | null;
  ac_api_key: string | null;
  ac_default_list_id: string | null;
  uchat_workspaces?: UchatWorkspaceRow[];
}

interface UchatWorkspaceRow {
  id: string;
  workspace_name: string;
  workspace_id: string;
  bot_id: string;
  api_token: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

async function requireAuthenticatedUser(request: Request, supabaseUrl: string, serviceRoleKey: string) {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authorization) {
    throw new ProcessContactError("Missing authorization header", 401);
  }

  const userAuthKey =
    Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
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
  launchSlug: string | null,
) {
  const lookup = launchId
    ? supabase.from("launches").select("id").eq("id", launchId).maybeSingle()
    : supabase.from("launches").select("id").eq("slug", launchSlug as string).maybeSingle();

  const { data: launch, error: lookupError } = await lookup;

  if (lookupError || !launch?.id) {
    throw new ProcessContactError("Launch not found", 404, lookupError?.message);
  }

  const { data: allowed, error: accessError } = await supabase.rpc("user_owns_launch", {
    _launch_id: launch.id,
    _user_id: userId,
  });

  if (accessError) {
    throw new ProcessContactError("Failed to validate launch access", 500, accessError.message);
  }

  if (!allowed) {
    throw new ProcessContactError("Launch access denied", 403);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function ensureNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildContactName(parts: Array<unknown>) {
  const fullName = parts
    .map(nonEmptyString)
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .trim();
  return fullName || null;
}

function normalizeActiveCampaignBaseUrl(apiUrl: string) {
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/3") ? trimmed.slice(0, -6) : trimmed;
}

async function fetchJsonWithRetry(url: string, init: RequestInit, retries = 2) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) {
        return await response.json();
      }

      const errorText = await response.text();
      if ((response.status === 429 || response.status >= 500) && attempt < retries) {
        await delay(500 * (attempt + 1));
        continue;
      }

      throw new Error(`HTTP ${response.status}: ${errorText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries) {
        await delay(500 * (attempt + 1));
      }
    }
  }

  throw lastError || new Error("Unknown request error");
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

  return await fetchJsonWithRetry(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Api-Token": apiKey,
    },
  });
}

async function uchatRequest(
  apiToken: string,
  path: string,
  query: Record<string, string | number | undefined> = {},
) {
  const url = new URL(`https://www.uchat.com.au/api${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  return await fetchJsonWithRetry(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  if (items.length === 0) return;

  let currentIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (currentIndex < items.length) {
      const itemIndex = currentIndex;
      currentIndex += 1;
      await worker(items[itemIndex], itemIndex);
    }
  });

  await Promise.all(workers);
}

async function insertProcessingLog(
  supabase: AnySupabaseClient,
  launchId: string,
  source: SyncSource,
  level: "info" | "warning" | "error" | "success",
  code: string,
  title: string,
  message: string,
  details: JsonRecord = {},
) {
  await supabase.from("contact_processing_logs").insert({
    launch_id: launchId,
    source,
    level,
    code,
    title,
    message,
    details,
  });
}

async function createSyncRun(
  supabase: AnySupabaseClient,
  launchId: string,
  source: SyncSource,
  metadata: JsonRecord,
) {
  const { data, error } = await supabase
    .from("platform_sync_runs")
    .insert({
      launch_id: launchId,
      source,
      status: "running",
      metadata,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Nao foi possivel abrir a rodada de sincronizacao.");
  }

  return (data as SyncRunRow).id;
}

async function completeSyncRun(
  supabase: AnySupabaseClient,
  runId: string,
  status: "completed" | "failed",
  counters: SyncCounters,
  metadata: JsonRecord,
  lastError?: string | null,
) {
  await supabase
    .from("platform_sync_runs")
    .update({
      status,
      processed_count: counters.processedCount,
      created_count: counters.createdCount,
      merged_count: counters.mergedCount,
      skipped_count: counters.skippedCount,
      error_count: counters.errorCount,
      metadata,
      last_error: lastError || null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

async function resolveLaunch(
  supabase: AnySupabaseClient,
  body: SyncRequestBody,
) {
  const launchLookup = body.launchId
    ? supabase
        .from("launches")
        .select("id, slug, name, ac_api_url, ac_api_key, ac_default_list_id")
        .eq("id", body.launchId)
        .maybeSingle()
    : supabase
        .from("launches")
        .select("id, slug, name, ac_api_url, ac_api_key, ac_default_list_id")
        .eq("slug", body.launchSlug as string)
        .maybeSingle();

  const { data: launch, error } = await launchLookup;
  if (error || !launch) {
    throw new ProcessContactError("Launch not found", 404, error?.message);
  }

  return launch as LaunchRow;
}

async function fetchUchatWorkspaces(
  supabase: AnySupabaseClient,
  launchId: string,
) {
  const { data, error } = await supabase
    .from("uchat_workspaces")
    .select("id, workspace_name, workspace_id, bot_id, api_token")
    .eq("launch_id", launchId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as UchatWorkspaceRow[];
}

async function fetchAllActiveCampaignCatalog(
  apiUrl: string,
  apiKey: string,
  path: string,
  rootKey: string,
) {
  const items: JsonRecord[] = [];
  let offset = 0;

  while (true) {
    const payload = await activeCampaignRequest(apiUrl, apiKey, path, {
      limit: activeCampaignPageSize,
      offset,
    });
    const batch = Array.isArray(payload[rootKey]) ? (payload[rootKey] as JsonRecord[]) : [];
    if (batch.length === 0) break;

    items.push(...batch);
    offset += batch.length;

    if (batch.length < activeCampaignPageSize) break;
  }

  return items;
}

async function fetchActiveCampaignContactSnapshot(
  apiUrl: string,
  apiKey: string,
  contactId: string,
  listsById: Map<string, JsonRecord>,
  tagsById: Map<string, JsonRecord>,
) {
  const [detailPayload, listPayload, tagPayload] = await Promise.all([
    activeCampaignRequest(apiUrl, apiKey, `/api/3/contacts/${contactId}`).catch(() => ({})),
    activeCampaignRequest(apiUrl, apiKey, `/api/3/contacts/${contactId}/contactLists`).catch(() => ({})),
    activeCampaignRequest(apiUrl, apiKey, `/api/3/contacts/${contactId}/contactTags`).catch(() => ({})),
  ]);

  const detailContact = (detailPayload.contact as JsonRecord | undefined) || {};
  const rawListMemberships = Array.isArray(listPayload.contactLists)
    ? (listPayload.contactLists as JsonRecord[])
    : Array.isArray(detailPayload.contactLists)
      ? (detailPayload.contactLists as JsonRecord[])
      : [];
  const rawTagMemberships = Array.isArray(tagPayload.contactTags)
    ? (tagPayload.contactTags as JsonRecord[])
    : Array.isArray(detailPayload.contactTags)
      ? (detailPayload.contactTags as JsonRecord[])
      : [];

  const lists = rawListMemberships.map((item) => {
    const listId = String(item.list ?? item.listid ?? "");
    const listCatalog = listId ? listsById.get(listId) : null;
    return {
      id: item.id ?? null,
      listId,
      name: nonEmptyString(listCatalog?.name) || nonEmptyString(listCatalog?.stringid) || null,
      status: item.status ?? null,
      subscribedAt: item.sdate ?? null,
      unsubscribedAt: item.udate ?? null,
      responder: item.responder ?? null,
    };
  });

  const tags = rawTagMemberships.map((item) => {
    const tagId = String(item.tag ?? item.tagid ?? "");
    const tagCatalog = tagId ? tagsById.get(tagId) : null;
    return {
      id: item.id ?? null,
      tagId,
      name: nonEmptyString(tagCatalog?.tag) || nonEmptyString(tagCatalog?.name) || null,
      createdAt: item.cdate ?? null,
    };
  });

  return {
    detailContact,
    fieldValues: Array.isArray(detailPayload.fieldValues) ? detailPayload.fieldValues : [],
    lists,
    tags,
  };
}

async function processPlatformContact(
  supabase: AnySupabaseClient,
  counters: SyncCounters,
  sampleErrors: string[],
  body: IncomingEventBody,
) {
  try {
    const result = await processIncomingContactEvent(supabase as any, body);
    counters.processedCount += 1;

    if (result.status === "rejected") {
      counters.skippedCount += 1;
      return;
    }

    if (result.action === "created") counters.createdCount += 1;
    if (result.action === "merged") counters.mergedCount += 1;
  } catch (error) {
    counters.errorCount += 1;
    if (sampleErrors.length < maxSampleErrors) {
      sampleErrors.push(toErrorMessage(error));
    }
  }
}

async function syncActiveCampaignContacts(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  counters: SyncCounters,
  sampleErrors: string[],
  maxContacts?: number,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) {
    throw new ProcessContactError(
      "As credenciais do ActiveCampaign ainda nao foram configuradas para esse lancamento.",
      400,
    );
  }

  const [listCatalog, tagCatalog] = await Promise.all([
    fetchAllActiveCampaignCatalog(launch.ac_api_url, launch.ac_api_key, "/api/3/lists", "lists"),
    fetchAllActiveCampaignCatalog(launch.ac_api_url, launch.ac_api_key, "/api/3/tags", "tags"),
  ]);

  const listsById = new Map(listCatalog.map((item) => [String(item.id), item]));
  const tagsById = new Map(tagCatalog.map((item) => [String(item.id), item]));

  let offset = 0;
  let pagesProcessed = 0;

  while (true) {
    if (maxContacts && counters.fetchedCount >= maxContacts) break;

    const payload = await activeCampaignRequest(launch.ac_api_url, launch.ac_api_key, "/api/3/contacts", {
      limit: activeCampaignPageSize,
      offset,
      "orders[id]": "ASC",
    });

    const contacts = Array.isArray(payload.contacts) ? (payload.contacts as JsonRecord[]) : [];
    if (contacts.length === 0) break;

    const allowedContacts =
      maxContacts && maxContacts > 0
        ? contacts.slice(0, Math.max(0, maxContacts - counters.fetchedCount))
        : contacts;

    counters.fetchedCount += allowedContacts.length;
    pagesProcessed += 1;

    await mapWithConcurrency(allowedContacts, defaultActiveCampaignConcurrency, async (contact) => {
      try {
        const contactId = nonEmptyString(contact.id);
        if (!contactId) {
          counters.errorCount += 1;
          if (sampleErrors.length < maxSampleErrors) {
            sampleErrors.push("Contato do ActiveCampaign sem id retornado pela API.");
          }
          return;
        }

        const snapshot = await fetchActiveCampaignContactSnapshot(
          launch.ac_api_url as string,
          launch.ac_api_key as string,
          contactId,
          listsById,
          tagsById,
        );

        const detailContact = snapshot.detailContact;
        const firstName = nonEmptyString(detailContact.firstName) || nonEmptyString(detailContact.first_name);
        const lastName = nonEmptyString(detailContact.lastName) || nonEmptyString(detailContact.last_name);
        const bodyForContact: IncomingEventBody = {
          launchId: launch.id,
          source: "activecampaign",
          eventType: "contact_import",
          externalContactId: contactId,
          contact: {
            name:
              buildContactName([
                detailContact.name,
                firstName,
                lastName,
                contact.name,
              ]) || `Contato ActiveCampaign ${contactId}`,
            email:
              nonEmptyString(detailContact.email) ||
              nonEmptyString(contact.email) ||
              nonEmptyString(detailContact.emailAddress),
            phone:
              nonEmptyString(detailContact.phone) ||
              nonEmptyString(contact.phone) ||
              nonEmptyString(detailContact.mobile),
          },
          payload: {
            contact: {
              ...contact,
              ...detailContact,
            },
            tags: snapshot.tags,
            lists: snapshot.lists,
            fieldValues: snapshot.fieldValues,
            defaultListId: launch.ac_default_list_id,
          },
        };

        await processPlatformContact(supabase, counters, sampleErrors, bodyForContact);
      } catch (error) {
        counters.errorCount += 1;
        if (sampleErrors.length < maxSampleErrors) {
          sampleErrors.push(toErrorMessage(error));
        }
      }
    });

    offset += contacts.length;
    if (contacts.length < activeCampaignPageSize) break;
  }

  return {
    pagesProcessed,
    listCount: listCatalog.length,
    tagCount: tagCatalog.length,
  };
}

async function syncUchatContacts(
  supabase: AnySupabaseClient,
  launch: LaunchRow,
  counters: SyncCounters,
  sampleErrors: string[],
  maxContacts?: number,
) {
  const workspaces = await fetchUchatWorkspaces(supabase, launch.id);
  const validWorkspaces = workspaces.filter((workspace) => nonEmptyString(workspace.api_token));

  if (validWorkspaces.length === 0) {
    throw new ProcessContactError("Nenhum workspace valido do UChat foi configurado para esse lancamento.", 400);
  }

  let pagesProcessed = 0;

  for (const workspace of validWorkspaces) {
    let page = 1;

    while (true) {
      if (maxContacts && counters.fetchedCount >= maxContacts) break;

      const payload = await uchatRequest(workspace.api_token, "/subscribers", {
        limit: uchatPageSize,
        page,
      });

      const subscribers = Array.isArray(payload.data) ? (payload.data as JsonRecord[]) : [];
      if (subscribers.length === 0) break;

      const allowedSubscribers =
        maxContacts && maxContacts > 0
          ? subscribers.slice(0, Math.max(0, maxContacts - counters.fetchedCount))
          : subscribers;

      counters.fetchedCount += allowedSubscribers.length;
      pagesProcessed += 1;

      await mapWithConcurrency(allowedSubscribers, defaultUchatConcurrency, async (subscriber) => {
        try {
          const externalContactId =
            nonEmptyString(subscriber.user_ns) ||
            nonEmptyString(subscriber.user_id) ||
            nonEmptyString(subscriber.email) ||
            nonEmptyString(subscriber.phone);

          const bodyForContact: IncomingEventBody = {
            launchId: launch.id,
            source: "uchat",
            eventType: "subscriber_import",
            externalContactId,
            contact: {
              name:
                buildContactName([
                  subscriber.name,
                  subscriber.first_name,
                  subscriber.last_name,
                ]) || "Subscriber UChat",
              email: nonEmptyString(subscriber.email),
              phone: nonEmptyString(subscriber.phone),
            },
            payload: {
              subscriber,
              tags: Array.isArray(subscriber.tags) ? subscriber.tags : [],
              userFields: Array.isArray(subscriber.user_fields) ? subscriber.user_fields : [],
              workspace: {
                id: workspace.workspace_id,
                name: workspace.workspace_name,
                botId: workspace.bot_id,
              },
            },
          };

          await processPlatformContact(supabase, counters, sampleErrors, bodyForContact);
        } catch (error) {
          counters.errorCount += 1;
          if (sampleErrors.length < maxSampleErrors) {
            sampleErrors.push(toErrorMessage(error));
          }
        }
      });

      page += 1;
      if (subscribers.length < uchatPageSize) break;
    }

    if (maxContacts && counters.fetchedCount >= maxContacts) break;
  }

  return {
    pagesProcessed,
    workspaceCount: validWorkspaces.length,
  };
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

  let body: SyncRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.source || !["activecampaign", "uchat"].includes(body.source)) {
    return jsonResponse({ error: "Invalid source" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let runId: string | null = null;
  let launch: LaunchRow | null = null;
  const counters: SyncCounters = {
    fetchedCount: 0,
    processedCount: 0,
    createdCount: 0,
    mergedCount: 0,
    skippedCount: 0,
    errorCount: 0,
  };
  const sampleErrors: string[] = [];

  try {
    const authenticatedUser = await requireAuthenticatedUser(request, supabaseUrl, serviceRoleKey);
    await assertLaunchAccess(
      supabase,
      authenticatedUser.id,
      body.launchId ?? null,
      body.launchSlug ?? null,
    );

    launch = await resolveLaunch(supabase, body);
    runId = await createSyncRun(supabase, launch.id, body.source, {
      requestedSource: body.source,
      maxContacts: body.maxContacts || null,
    });

    await insertProcessingLog(
      supabase,
      launch.id,
      body.source,
      "info",
      "SYNC_STARTED",
      "Sincronizacao iniciada",
      `A importacao de contatos do ${body.source} foi iniciada para o lancamento ${launch.name}.`,
      {
        runId,
        source: body.source,
        maxContacts: body.maxContacts || null,
      },
    );

    const syncMetadata =
      body.source === "activecampaign"
        ? await syncActiveCampaignContacts(supabase, launch, counters, sampleErrors, ensureNumber(body.maxContacts, 0) || undefined)
        : await syncUchatContacts(supabase, launch, counters, sampleErrors, ensureNumber(body.maxContacts, 0) || undefined);

    const finalMetadata = {
      ...syncMetadata,
      fetchedCount: counters.fetchedCount,
      sampleErrors,
    };

    await completeSyncRun(supabase, runId, "completed", counters, finalMetadata);

    await insertProcessingLog(
      supabase,
      launch.id,
      body.source,
      counters.errorCount > 0 ? "warning" : "success",
      "SYNC_COMPLETED",
      "Sincronizacao concluida",
      `A importacao do ${body.source} terminou com ${counters.createdCount} contatos novos e ${counters.mergedCount} merges.`,
      {
        runId,
        ...counters,
        ...finalMetadata,
      },
    );

    return jsonResponse({
      runId,
      source: body.source,
      launchId: launch.id,
      counters,
      metadata: finalMetadata,
    });
  } catch (error) {
    const message = toErrorMessage(error);

    if (runId) {
      await completeSyncRun(
        supabase,
        runId,
        "failed",
        counters,
        {
          fetchedCount: counters.fetchedCount,
          sampleErrors: [...sampleErrors, message].slice(0, maxSampleErrors),
        },
        message,
      );
    }

    if (launch) {
      await insertProcessingLog(
        supabase,
        launch.id,
        body.source,
        "error",
        "SYNC_FAILED",
        "Sincronizacao falhou",
        `A importacao do ${body.source} nao foi concluida.`,
        {
          runId,
          ...counters,
          error: message,
          sampleErrors: [...sampleErrors, message].slice(0, maxSampleErrors),
        },
      );
    }

    if (error instanceof ProcessContactError) {
      return jsonResponse({ error: error.message, details: error.details ?? null }, error.statusCode);
    }

    console.error("sync-platform-contacts failed", error);
    return jsonResponse({ error: message }, 500);
  }
});

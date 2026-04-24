// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
type AnySupabaseClient = any;
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
const defaultActiveCampaignProcessConcurrency = 3;
const defaultUchatConcurrency = 10;
const defaultActiveCampaignChunkSize = 150;
const activeCampaignCheckpointBatchSize = 25;
const maxActiveCampaignChunkSize = 2000;
const defaultActiveCampaignRuntimeMs = 12000;
const activeCampaignChainGraceMs = 120000;
const maxSampleErrors = 10;
const ACTIVE_CAMPAIGN_SYNC_DISABLED = true;

type SyncSource = "activecampaign" | "uchat";
type ActiveCampaignSyncMode = "full" | "resume" | "incremental";
type JsonRecord = Record<string, unknown>;

interface SyncRequestBody {
  launchId?: string;
  launchSlug?: string;
  source: SyncSource;
  maxContacts?: number;
  syncMode?: ActiveCampaignSyncMode;
  trigger?: string;
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

interface PlatformSyncRunRow extends SyncRunRow {
  status: "running" | "completed" | "failed";
  metadata: unknown;
  started_at: string;
  finished_at: string | null;
  last_error: string | null;
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

interface ActiveCampaignSyncPlan {
  mode: ActiveCampaignSyncMode;
  chunkSize: number;
  lastContactId: number;
  updatedAfter: string | null;
  updatedBefore: string | null;
  resumedFromRunId: string | null;
  previousSyncedUntil: string | null;
  aggregateBase: SyncCounters;
}

interface ActiveCampaignSyncCursor {
  mode: ActiveCampaignSyncMode;
  lastContactId: number;
  hasMore: boolean;
  updatedAfter: string | null;
  updatedBefore: string | null;
}

type ActiveCampaignCompletionReason =
  | "in_progress"
  | "finished"
  | "chunk_limit"
  | "runtime_limit";

interface ActiveCampaignSyncProgress {
  plan: ActiveCampaignSyncPlan;
  lastContactId: number;
  pagesProcessed: number;
  lastSeenUpdatedAt: string | null;
  completionReason: ActiveCampaignCompletionReason;
  hasMore: boolean;
}

interface EdgeRuntimeLike {
  waitUntil(promise: Promise<unknown>): void;
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

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getEdgeRuntime() {
  return (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime ?? null;
}

function buildFunctionUrl(supabaseUrl: string, functionName: string) {
  const normalizedBase = `${supabaseUrl.replace(/\/+$/, "")}/`;
  return new URL(`functions/v1/${functionName}`, normalizedBase).toString();
}

async function dispatchChainedActiveCampaignSync(
  supabaseUrl: string,
  launchId: string,
  maxContacts: number,
) {
  const cronSecret = nonEmptyString(Deno.env.get("LAUNCHHUB_SYNC_CRON_SECRET"));
  if (!cronSecret) {
    throw new Error("LAUNCHHUB_SYNC_CRON_SECRET is not configured.");
  }

  const response = await fetch(buildFunctionUrl(supabaseUrl, "sync-platform-contacts"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-launchhub-cron-secret": cronSecret,
    },
    body: JSON.stringify({
      launchId,
      source: "activecampaign",
      syncMode: "resume",
      maxContacts,
      trigger: "background_chain",
    } satisfies SyncRequestBody),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
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

function hasInternalSyncAuthorization(request: Request) {
  const configuredSecret = nonEmptyString(Deno.env.get("LAUNCHHUB_SYNC_CRON_SECRET"));
  const providedSecret = nonEmptyString(request.headers.get("x-launchhub-cron-secret"));

  return Boolean(configuredSecret && providedSecret && configuredSecret === providedSecret);
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

function parseRetryAfterMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) {
    return 500 * (attempt + 1);
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateValue = Date.parse(retryAfter);
  if (Number.isFinite(dateValue)) {
    return Math.max(0, dateValue - Date.now());
  }

  return 500 * (attempt + 1);
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

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
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

function extractActiveCampaignTimestamp(contact: JsonRecord) {
  return (
    nonEmptyString(contact.updated_utc_timestamp) ||
    nonEmptyString(contact.updatedAt) ||
    nonEmptyString(contact.udate) ||
    nonEmptyString(contact.cdate) ||
    null
  );
}

function parseActiveCampaignSyncMode(value: unknown): ActiveCampaignSyncMode | null {
  if (value === "full" || value === "resume" || value === "incremental") {
    return value;
  }

  return null;
}

function parseActiveCampaignCursor(metadata: unknown) {
  const root = isRecord(metadata) ? metadata : {};
  const cursor = isRecord(root.cursor) ? root.cursor : {};

  return {
    mode:
      parseActiveCampaignSyncMode(cursor.mode) ||
      parseActiveCampaignSyncMode(root.mode) ||
      null,
    lastContactId: ensureNumber(
      cursor.lastContactId ?? root.lastContactId ?? root.nextIdGreater,
      0,
    ),
    hasMore: Boolean(cursor.hasMore ?? root.hasMore),
    updatedAfter:
      nonEmptyString(cursor.updatedAfter) ||
      nonEmptyString(root.updatedAfter) ||
      null,
    updatedBefore:
      nonEmptyString(cursor.updatedBefore) ||
      nonEmptyString(root.updatedBefore) ||
      null,
    syncedUntil:
      nonEmptyString(root.syncedUntil) ||
      nonEmptyString(cursor.syncedUntil) ||
      nonEmptyString(cursor.updatedBefore) ||
      nonEmptyString(root.updatedBefore) ||
      null,
  };
}

function parseAggregateCounters(metadata: unknown): SyncCounters {
  const root = isRecord(metadata) ? metadata : {};
  const aggregate = isRecord(root.aggregateCounters) ? root.aggregateCounters : {};

  return {
    fetchedCount: ensureNumber(aggregate.fetchedCount, 0),
    processedCount: ensureNumber(aggregate.processedCount, 0),
    createdCount: ensureNumber(aggregate.createdCount, 0),
    mergedCount: ensureNumber(aggregate.mergedCount, 0),
    skippedCount: ensureNumber(aggregate.skippedCount, 0),
    errorCount: ensureNumber(aggregate.errorCount, 0),
  };
}

function sumCounters(left: SyncCounters, right: SyncCounters): SyncCounters {
  return {
    fetchedCount: left.fetchedCount + right.fetchedCount,
    processedCount: left.processedCount + right.processedCount,
    createdCount: left.createdCount + right.createdCount,
    mergedCount: left.mergedCount + right.mergedCount,
    skippedCount: left.skippedCount + right.skippedCount,
    errorCount: left.errorCount + right.errorCount,
  };
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
        await delay(parseRetryAfterMs(response, attempt));
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

async function updateRunningSyncRun(
  supabase: AnySupabaseClient,
  runId: string,
  counters: SyncCounters,
  metadata: JsonRecord,
  lastError?: string | null,
) {
  await supabase
    .from("platform_sync_runs")
    .update({
      processed_count: counters.processedCount,
      created_count: counters.createdCount,
      merged_count: counters.mergedCount,
      skipped_count: counters.skippedCount,
      error_count: counters.errorCount,
      metadata,
      last_error: lastError || null,
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

async function fetchLatestSyncRun(
  supabase: AnySupabaseClient,
  launchId: string,
  source: SyncSource,
) {
  const { data, error } = await supabase
    .from("platform_sync_runs")
    .select("id, status, metadata, started_at, finished_at, last_error")
    .eq("launch_id", launchId)
    .eq("source", source)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as PlatformSyncRunRow | null) || null;
}

function buildActiveCampaignSyncPlan(
  body: SyncRequestBody,
  latestRun: PlatformSyncRunRow | null,
): ActiveCampaignSyncPlan {
  const latestCursor = parseActiveCampaignCursor(latestRun?.metadata);
  const requestedMode = parseActiveCampaignSyncMode(body.syncMode);
  const latestSyncedUntil = latestCursor.syncedUntil;
  const nowIso = new Date().toISOString();
  const chunkSize = clampNumber(
    ensureNumber(body.maxContacts, defaultActiveCampaignChunkSize) || defaultActiveCampaignChunkSize,
    activeCampaignPageSize,
    maxActiveCampaignChunkSize,
  );
  const emptyCounters: SyncCounters = {
    fetchedCount: 0,
    processedCount: 0,
    createdCount: 0,
    mergedCount: 0,
    skippedCount: 0,
    errorCount: 0,
  };

  let mode =
    requestedMode ||
    (latestCursor.hasMore ? "resume" : latestSyncedUntil ? "incremental" : "full");

  if (mode === "resume" && latestCursor.hasMore && latestRun) {
    return {
      mode: latestCursor.mode || (latestSyncedUntil ? "incremental" : "full"),
      chunkSize,
      lastContactId: Math.max(0, latestCursor.lastContactId),
      updatedAfter: latestCursor.updatedAfter,
      updatedBefore: latestCursor.updatedBefore || nowIso,
      resumedFromRunId: latestRun.id,
      previousSyncedUntil: latestSyncedUntil,
      aggregateBase: parseAggregateCounters(latestRun.metadata),
    };
  }

  if (mode === "resume") {
    mode = latestSyncedUntil ? "incremental" : "full";
  }

  if (mode === "incremental" && latestSyncedUntil) {
    return {
      mode,
      chunkSize,
      lastContactId: 0,
      updatedAfter: latestSyncedUntil,
      updatedBefore: nowIso,
      resumedFromRunId: null,
      previousSyncedUntil: latestSyncedUntil,
      aggregateBase: emptyCounters,
    };
  }

  return {
    mode: "full",
    chunkSize,
    lastContactId: 0,
    updatedAfter: null,
    updatedBefore: nowIso,
    resumedFromRunId: null,
    previousSyncedUntil: latestSyncedUntil,
    aggregateBase: emptyCounters,
  };
}

function hasRecentActiveCampaignSyncActivity(run: PlatformSyncRunRow | null) {
  if (!run) return false;

  const referenceAt =
    (run.status === "running" ? nonEmptyString(run.started_at) : nonEmptyString(run.finished_at)) ||
    nonEmptyString(run.started_at);
  if (!referenceAt) return false;

  const referenceAtMs = Date.parse(referenceAt);
  if (!Number.isFinite(referenceAtMs)) return false;

  return Date.now() - referenceAtMs < activeCampaignChainGraceMs;
}

function buildActiveCampaignSyncMetadata(
  body: SyncRequestBody,
  progress: ActiveCampaignSyncProgress,
  counters: SyncCounters,
  sampleErrors: string[],
): JsonRecord {
  const aggregateCounters = sumCounters(progress.plan.aggregateBase, counters);
  const syncedUntil = progress.hasMore
    ? progress.plan.previousSyncedUntil
    : progress.plan.updatedBefore || new Date().toISOString();

  return {
    mode: progress.plan.mode,
    requestedSyncMode: parseActiveCampaignSyncMode(body.syncMode),
    pagesProcessed: progress.pagesProcessed,
    chunkSize: progress.plan.chunkSize,
    resumedFromRunId: progress.plan.resumedFromRunId,
    previousSyncedUntil: progress.plan.previousSyncedUntil,
    syncedUntil,
    lastSeenUpdatedAt: progress.lastSeenUpdatedAt,
    completionReason: progress.completionReason,
    cursor: {
      mode: progress.plan.mode,
      lastContactId: progress.lastContactId,
      hasMore: progress.hasMore,
      updatedAfter: progress.plan.updatedAfter,
      updatedBefore: progress.plan.updatedBefore,
    },
    aggregateCounters,
    fetchedCount: counters.fetchedCount,
    sampleErrors: sampleErrors.slice(0, maxSampleErrors),
  };
}

async function fetchActiveCampaignContactsPage(
  apiUrl: string,
  apiKey: string,
  plan: ActiveCampaignSyncPlan,
  lastContactId: number,
) {
  const payload = await activeCampaignRequest(apiUrl, apiKey, "/api/3/contacts", {
    limit: activeCampaignPageSize,
    id_greater: lastContactId > 0 ? lastContactId : undefined,
    "orders[id]": "ASC",
    "filters[updated_after]": plan.updatedAfter ?? undefined,
    "filters[updated_before]": plan.updatedBefore ?? undefined,
  });

  const contacts = Array.isArray(payload.contacts) ? (payload.contacts as JsonRecord[]) : [];
  return { contacts };
}

function buildActiveCampaignIncomingBody(
  launch: LaunchRow,
  contact: JsonRecord,
): IncomingEventBody {
  const contactId = nonEmptyString(contact.id);
  const firstName = nonEmptyString(contact.firstName) || nonEmptyString(contact.first_name);
  const lastName = nonEmptyString(contact.lastName) || nonEmptyString(contact.last_name);

  return {
    launchId: launch.id,
    source: "activecampaign",
    eventType: "contact_import",
    externalContactId: contactId,
    contact: {
      name:
        buildContactName([
          contact.name,
          firstName,
          lastName,
        ]) || (contactId ? `Contato ActiveCampaign ${contactId}` : "Contato ActiveCampaign"),
      email: nonEmptyString(contact.email) || nonEmptyString(contact.emailAddress),
      phone: nonEmptyString(contact.phone) || nonEmptyString(contact.mobile),
    },
    payload: {
      contact,
      defaultListId: launch.ac_default_list_id,
      importedBy: {
        source: "sync-platform-contacts",
      },
    },
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
  body: SyncRequestBody,
  counters: SyncCounters,
  sampleErrors: string[],
  runId: string,
  latestRun: PlatformSyncRunRow | null,
  onProgress?: (progress: ActiveCampaignSyncProgress) => void,
) {
  if (!launch.ac_api_url || !launch.ac_api_key) {
    throw new ProcessContactError(
      "As credenciais do ActiveCampaign ainda nao foram configuradas para esse lancamento.",
      400,
    );
  }

  const plan = buildActiveCampaignSyncPlan(body, latestRun);
  const startedAt = Date.now();
  const progress: ActiveCampaignSyncProgress = {
    plan,
    lastContactId: plan.lastContactId,
    pagesProcessed: 0,
    lastSeenUpdatedAt: null,
    completionReason: "in_progress",
    hasMore: true,
  };

  onProgress?.(progress);

  syncLoop: while (true) {
    if (counters.fetchedCount >= plan.chunkSize) {
      progress.hasMore = true;
      progress.completionReason = "chunk_limit";
      break;
    }

    if (Date.now() - startedAt >= defaultActiveCampaignRuntimeMs) {
      progress.hasMore = true;
      progress.completionReason = "runtime_limit";
      break;
    }

    const { contacts } = await fetchActiveCampaignContactsPage(
      launch.ac_api_url,
      launch.ac_api_key,
      plan,
      progress.lastContactId,
    );
    if (contacts.length === 0) {
      progress.hasMore = false;
      break;
    }

    const remainingCapacity = Math.max(0, plan.chunkSize - counters.fetchedCount);
    const allowedContacts = contacts.slice(0, remainingCapacity);

    progress.pagesProcessed += 1;

    for (let index = 0; index < allowedContacts.length; index += activeCampaignCheckpointBatchSize) {
      if (Date.now() - startedAt >= defaultActiveCampaignRuntimeMs) {
        progress.hasMore = true;
        progress.completionReason = "runtime_limit";
        break syncLoop;
      }

      const checkpointContacts = allowedContacts.slice(index, index + activeCampaignCheckpointBatchSize);
      if (checkpointContacts.length === 0) continue;

      counters.fetchedCount += checkpointContacts.length;

      await mapWithConcurrency(
        checkpointContacts,
        defaultActiveCampaignProcessConcurrency,
        async (contact) => {
          try {
            const contactId = nonEmptyString(contact.id);
            if (!contactId) {
              counters.errorCount += 1;
              if (sampleErrors.length < maxSampleErrors) {
                sampleErrors.push("Contato do ActiveCampaign sem id retornado pela API.");
              }
              return;
            }

            await processPlatformContact(
              supabase,
              counters,
              sampleErrors,
              buildActiveCampaignIncomingBody(launch, contact),
            );
          } catch (error) {
            counters.errorCount += 1;
            if (sampleErrors.length < maxSampleErrors) {
              sampleErrors.push(toErrorMessage(error));
            }
          }
        },
      );

      for (const contact of checkpointContacts) {
        const numericContactId = ensureNumber(contact.id, 0);
        if (numericContactId > progress.lastContactId) {
          progress.lastContactId = numericContactId;
        }

        const updatedAt = extractActiveCampaignTimestamp(contact);
        if (updatedAt && (!progress.lastSeenUpdatedAt || updatedAt > progress.lastSeenUpdatedAt)) {
          progress.lastSeenUpdatedAt = updatedAt;
        }
      }

      progress.hasMore = true;
      progress.completionReason = "in_progress";
      onProgress?.(progress);
      await updateRunningSyncRun(
        supabase,
        runId,
        counters,
        buildActiveCampaignSyncMetadata(body, progress, counters, sampleErrors),
      );
    }

    if (allowedContacts.length < contacts.length) {
      progress.hasMore = true;
      progress.completionReason = "chunk_limit";
      break;
    }

    if (contacts.length < activeCampaignPageSize) {
      progress.hasMore = false;
      break;
    }
  }

  if (progress.completionReason === "in_progress") {
    progress.completionReason = progress.hasMore ? "chunk_limit" : "finished";
  }

  onProgress?.(progress);
  return buildActiveCampaignSyncMetadata(body, progress, counters, sampleErrors);
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
  const isInternalSync = hasInternalSyncAuthorization(request);
  let runId: string | null = null;
  let launch: LaunchRow | null = null;
  let latestActiveCampaignRun: PlatformSyncRunRow | null = null;
  let activeCampaignProgress: ActiveCampaignSyncProgress | null = null;
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
    if (!body.launchId && !body.launchSlug) {
      throw new ProcessContactError("launchId or launchSlug is required", 400);
    }

    if (!isInternalSync) {
      const authenticatedUser = await requireAuthenticatedUser(request, supabaseUrl, serviceRoleKey);
      await assertLaunchAccess(
        supabase,
        authenticatedUser.id,
        body.launchId ?? null,
        body.launchSlug ?? null,
      );
    }

    launch = await resolveLaunch(supabase, body);

    if (body.source === "activecampaign" && ACTIVE_CAMPAIGN_SYNC_DISABLED) {
      return jsonResponse({
        skipped: true,
        reason: "activecampaign_sync_disabled",
        launchId: launch.id,
        source: body.source,
        message: "ActiveCampaign base sync has been disabled. Launch Hub now processes only webhook contacts.",
      }, 202);
    }

    if (body.source === "activecampaign") {
      latestActiveCampaignRun = await fetchLatestSyncRun(supabase, launch.id, "activecampaign");

      if (
        nonEmptyString(body.trigger) === "scheduled_cron" &&
        latestActiveCampaignRun &&
        hasRecentActiveCampaignSyncActivity(latestActiveCampaignRun)
      ) {
        const latestCursor = parseActiveCampaignCursor(latestActiveCampaignRun.metadata);
        if (
          latestActiveCampaignRun.status === "running" ||
          latestCursor.hasMore
        ) {
          return jsonResponse({
            skipped: true,
            reason:
              latestActiveCampaignRun.status === "running"
                ? "activecampaign_sync_already_running"
                : "activecampaign_background_chain_in_progress",
            launchId: launch.id,
            latestRunId: latestActiveCampaignRun.id,
          }, 202);
        }
      }
    }

    runId = await createSyncRun(supabase, launch.id, body.source, {
      requestedSource: body.source,
      requestedSyncMode: parseActiveCampaignSyncMode(body.syncMode),
      maxContacts:
        body.source === "activecampaign"
          ? clampNumber(
              ensureNumber(body.maxContacts, defaultActiveCampaignChunkSize) || defaultActiveCampaignChunkSize,
              activeCampaignPageSize,
              maxActiveCampaignChunkSize,
            )
          : body.maxContacts || null,
      trigger: nonEmptyString(body.trigger) || (isInternalSync ? "scheduled" : "manual"),
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
        syncMode: parseActiveCampaignSyncMode(body.syncMode),
        maxContacts: body.maxContacts || null,
        trigger: nonEmptyString(body.trigger) || (isInternalSync ? "scheduled" : "manual"),
      },
    );

    const syncMetadata =
      body.source === "activecampaign"
        ? await syncActiveCampaignContacts(
            supabase,
            launch,
            body,
            counters,
            sampleErrors,
            runId,
            latestActiveCampaignRun,
            (progress) => {
              activeCampaignProgress = {
                ...progress,
                plan: {
                  ...progress.plan,
                  aggregateBase: { ...progress.plan.aggregateBase },
                },
              };
            },
          )
        : await syncUchatContacts(supabase, launch, counters, sampleErrors, ensureNumber(body.maxContacts, 0) || undefined);

    const finalMetadata: Record<string, unknown> = {
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
      body.source === "activecampaign" && isRecord(finalMetadata.cursor) && finalMetadata.cursor.hasMore
        ? `A sincronizacao do ${body.source} processou mais um lote e ainda possui contatos pendentes para continuar.`
        : `A importacao do ${body.source} terminou com ${counters.createdCount} contatos novos e ${counters.mergedCount} merges.`,
      {
        runId,
        ...counters,
        ...finalMetadata,
      },
    );

    if (
      body.source === "activecampaign" &&
      isRecord(finalMetadata.cursor) &&
      finalMetadata.cursor.hasMore === true
    ) {
      const continuationMaxContacts = clampNumber(
        ensureNumber(finalMetadata.chunkSize ?? body.maxContacts, defaultActiveCampaignChunkSize) ||
          defaultActiveCampaignChunkSize,
        activeCampaignPageSize,
        maxActiveCampaignChunkSize,
      );
      const chainLaunchId = launch.id;
      const backgroundPromise = dispatchChainedActiveCampaignSync(
        supabaseUrl,
        chainLaunchId,
        continuationMaxContacts,
      ).catch(async (dispatchError) => {
        console.error("Failed to dispatch chained ActiveCampaign sync", dispatchError);
        await insertProcessingLog(
          supabase,
          chainLaunchId,
          body.source,
          "warning",
          "SYNC_CHAIN_FAILED",
          "Continuacao automatica falhou",
          "O lote atual terminou, mas o backend nao conseguiu iniciar automaticamente o proximo lote.",
          {
            runId,
            error: toErrorMessage(dispatchError),
            maxContacts: continuationMaxContacts,
          },
        );
      });
      const runtime = getEdgeRuntime();
      if (runtime) {
        runtime.waitUntil(backgroundPromise);
      } else {
        void backgroundPromise;
      }
    }

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
      const progressSnapshot: ActiveCampaignSyncProgress | null = (() => activeCampaignProgress)();
      const failureMetadata =
        body.source === "activecampaign" && progressSnapshot
          ? buildActiveCampaignSyncMetadata(
              body,
              {
                ...progressSnapshot,
                hasMore: true,
                completionReason:
                  progressSnapshot.completionReason === "finished"
                    ? "in_progress"
                    : progressSnapshot.completionReason,
              },
              counters,
              [...sampleErrors, message],
            )
          : {
              fetchedCount: counters.fetchedCount,
              sampleErrors: [...sampleErrors, message].slice(0, maxSampleErrors),
            };

      await completeSyncRun(
        supabase,
        runId,
        "failed",
        counters,
        failureMetadata,
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

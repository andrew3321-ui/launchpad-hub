import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Json } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useLaunch } from "@/contexts/LaunchContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  buildLaunchWebhookUrl,
  inboundWebhookSources,
} from "@/lib/webhookRouter";
import { Copy, Loader2, Plus, Radio, Upload, Webhook, X } from "lucide-react";
import {
  ActiveCampaignSourceTagBindings,
  type ActiveCampaignTagOption,
} from "@/components/launches/ActiveCampaignSourceTagBindings";
import {
  NamedTagsEditor,
  type NamedTagDraft,
} from "@/components/launches/NamedTagsEditor";
import {
  UChatWorkspacesEditor,
  type UChatWorkspaceDraft,
} from "@/components/launches/UChatWorkspacesEditor";

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initCodeClient: (config: Record<string, unknown>) => {
            requestCode: () => void;
          };
        };
      };
    };
  }
}

type GoogleSheetsAuthMode = "service_account" | "oauth";

interface LaunchSettingsRow {
  id: string;
  name: string;
  project_id: string | null;
  slug: string | null;
  webhook_secret: string;
  ac_api_url: string | null;
  ac_api_key: string | null;
  ac_default_list_id: string | null;
  ac_named_tags: unknown;
  current_cycle_number: number;
  current_cycle_started_at: string | null;
  gs_enabled: boolean;
  gs_auth_mode: GoogleSheetsAuthMode;
  gs_oauth_email: string | null;
  gs_oauth_connected: boolean;
  gs_service_account_email: string | null;
  gs_private_key: string | null;
  gs_spreadsheet_id: string | null;
  gs_spreadsheet_title: string | null;
  gs_sheet_name: string | null;
  gs_capture_tag_id: string | null;
  gs_capture_tag_name: string | null;
  gs_default_product_name: string | null;
}

interface SourcesDraft {
  acApiUrl: string;
  acApiKey: string;
  acListId: string;
  acNamedTags: NamedTagDraft[];
  uchatWorkspaces: UChatWorkspaceDraft[];
  gsEnabled: boolean;
  gsAuthMode: GoogleSheetsAuthMode;
  gsOauthEmail: string;
  gsOauthConnected: boolean;
  gsServiceAccountEmail: string;
  gsPrivateKey: string;
  gsSpreadsheetId: string;
  gsSpreadsheetTitle: string;
  gsSheetName: string;
  gsCaptureTagId: string;
  gsCaptureTagName: string;
  gsDefaultProductName: string;
}

interface LaunchSourcesPayload {
  launch: LaunchSettingsRow;
  uchat_workspaces: Array<Record<string, unknown>>;
}

interface ActiveCampaignCatalogResponse {
  tags: ActiveCampaignTagOption[];
  loadedAt?: string;
}

interface SyncCountersSummary {
  fetchedCount: number;
  processedCount: number;
  createdCount: number;
  mergedCount: number;
  skippedCount: number;
  errorCount: number;
}

interface ActiveCampaignSyncCursor {
  hasMore: boolean;
  syncedUntil: string | null;
}

interface ActiveCampaignSyncRunSummary {
  id: string;
  status: string;
  processed_count: number;
  created_count: number;
  merged_count: number;
  skipped_count: number;
  error_count: number;
  started_at: string;
  finished_at: string | null;
  last_error: string | null;
  metadata: Json | null;
}

interface SyncPlatformContactsResponse {
  runId: string;
  source: "activecampaign" | "uchat";
  launchId: string;
  counters: SyncCountersSummary;
  metadata: Json | null;
}

interface GoogleSheetsCatalogResponse {
  authMode: GoogleSheetsAuthMode;
  connectionEmail: string | null;
  spreadsheets: Array<{
    id: string;
    title: string | null;
    modifiedTime: string | null;
    ownerEmail: string | null;
    ownerName: string | null;
  }>;
  selectedSpreadsheetId: string | null;
  selectedSpreadsheetTitle: string | null;
  sheets: Array<{
    id: number | null;
    title: string | null;
    index: number | null;
  }>;
  catalogWarning?: string | null;
}

interface GoogleOauthExchangeResponse {
  connected: boolean;
  email: string | null;
  launch: LaunchSettingsRow;
}

interface CsvColumnMapping {
  value: string;
  sheetColumn: string;
}

type BulkCsvMode = "fixed_update" | "active_export_import";

const FIXED_UPDATE_BATCH_SIZE = 300;
const ACTIVE_CSV_IMPORT_BATCH_SIZE = 120;

interface ParsedCsvUpload {
  headers: string[];
  rows: Array<Record<string, string>>;
}

interface GoogleSheetsBulkUpdateResponse {
  success: boolean;
  summary: {
    mode: BulkCsvMode;
    receivedRows: number;
    uniqueIdentities: number;
    uniqueEmails: number;
    missingIdentityRows: number;
    missingEmailRows: number;
    duplicatedInputIdentities: number;
    duplicatedInputEmails: number;
    matchedRows: number;
    matchedByPhoneRows: number;
    updatedRows: number;
    updatedCells: number;
    missingFromSheetRows: number;
    insertedFromActive: number;
    insertedFromCsv: number;
    activeContactsNotFound: number;
    activeContactsFoundByPhone: number;
    activeContactsWithoutCaptureTag: number;
    activeLookupErrors: number;
    activeCaptureTagMissing: number;
    notFoundRows: number;
    skippedBlankCells: number;
    skippedUnchangedCells: number;
    sheetName: string;
    spreadsheetId: string;
    captureTagId: string | null;
    captureTagName: string | null;
  };
  notFound: Array<{
    email: string;
    name: string | null;
    phone: string | null;
    reason: string;
  }>;
}

const MANAGED_SOURCE_ALIASES = [
  {
    alias: "typebot",
    label: "Typebot",
    helper: "Tags aplicadas quando o contato entrar pelo webhook do Typebot.",
  },
  {
    alias: "manychat",
    label: "ManyChat",
    helper: "Tags aplicadas quando o contato entrar pelo webhook do ManyChat.",
  },
  {
    alias: "tally",
    label: "Tally",
    helper: "Tags aplicadas quando a resposta da pesquisa entrar pelo webhook do Tally.",
  },
  {
    alias: "sendflow",
    label: "Sendflow",
    helper: "Tags aplicadas quando o contato entrar pelo webhook do Sendflow.",
  },
  {
    alias: "uchat",
    label: "UChat",
    helper: "Tags aplicadas quando o contato entrar pelo webhook do UChat.",
  },
] as const;
const ACTIVECAMPAIGN_CATALOG_TIMEOUT_MS = 15000;
const ACTIVE_CAMPAIGN_STALE_SYNC_MS = 90_000;
const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_OAUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined;
const DEFAULT_GOOGLE_SHEET_NAME = "Página1";
const NO_CAPTURE_TAG_VALUE = "__none";
const CAPTURE_SHEET_COLUMNS = [
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
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "openid",
  "email",
  "profile",
].join(" ");

function buildCatalogScopeKey(launchId: string, apiUrl: string, apiKey: string) {
  return [launchId, apiUrl.trim(), apiKey.trim()].join("::");
}

function buildSourcesDraftKey(launchId: string) {
  return `launchhub:sources-draft:${launchId}`;
}

function parseSourcesDraft(raw: string | null): SourcesDraft | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SourcesDraft>;
    return {
      acApiUrl: typeof parsed.acApiUrl === "string" ? parsed.acApiUrl : "",
      acApiKey: typeof parsed.acApiKey === "string" ? parsed.acApiKey : "",
      acListId: typeof parsed.acListId === "string" ? parsed.acListId : "",
      acNamedTags: Array.isArray(parsed.acNamedTags) ? (parsed.acNamedTags as NamedTagDraft[]) : [],
      uchatWorkspaces: Array.isArray(parsed.uchatWorkspaces)
        ? (parsed.uchatWorkspaces as UChatWorkspaceDraft[])
        : [],
      gsEnabled: typeof parsed.gsEnabled === "boolean" ? parsed.gsEnabled : false,
      gsAuthMode: parsed.gsAuthMode === "oauth" ? "oauth" : "service_account",
      gsOauthEmail: typeof parsed.gsOauthEmail === "string" ? parsed.gsOauthEmail : "",
      gsOauthConnected: typeof parsed.gsOauthConnected === "boolean" ? parsed.gsOauthConnected : false,
      gsServiceAccountEmail:
        typeof parsed.gsServiceAccountEmail === "string" ? parsed.gsServiceAccountEmail : "",
      gsPrivateKey: typeof parsed.gsPrivateKey === "string" ? parsed.gsPrivateKey : "",
      gsSpreadsheetId: typeof parsed.gsSpreadsheetId === "string" ? parsed.gsSpreadsheetId : "",
      gsSpreadsheetTitle:
        typeof parsed.gsSpreadsheetTitle === "string" ? parsed.gsSpreadsheetTitle : "",
      gsSheetName: typeof parsed.gsSheetName === "string" ? parsed.gsSheetName : "",
      gsCaptureTagId: typeof parsed.gsCaptureTagId === "string" ? parsed.gsCaptureTagId : "",
      gsCaptureTagName: typeof parsed.gsCaptureTagName === "string" ? parsed.gsCaptureTagName : "",
      gsDefaultProductName:
        typeof parsed.gsDefaultProductName === "string" ? parsed.gsDefaultProductName : "",
    };
  } catch {
    return null;
  }
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function ensureSyncNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeGoogleSheetsAuthMode(value: unknown): GoogleSheetsAuthMode {
  return value === "oauth" ? "oauth" : "service_account";
}

let googleIdentityScriptPromise: Promise<void> | null = null;

async function ensureGoogleIdentityScript() {
  if (window.google?.accounts?.oauth2?.initCodeClient) {
    return;
  }

  if (!googleIdentityScriptPromise) {
    googleIdentityScriptPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[src="${GOOGLE_IDENTITY_SCRIPT_SRC}"]`,
      );

      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener(
          "error",
          () => reject(new Error("Não foi possivel carregar o login do Google.")),
          { once: true },
        );
        return;
      }

      const script = document.createElement("script");
      script.src = GOOGLE_IDENTITY_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Não foi possivel carregar o login do Google."));
      document.head.appendChild(script);
    });
  }

  return googleIdentityScriptPromise;
}

function parseActiveCampaignSyncCursor(metadata: Json | null | undefined): ActiveCampaignSyncCursor {
  const root = asRecord(metadata);
  const cursor = asRecord(root?.cursor);

  const hasMore = Boolean(cursor?.hasMore ?? root?.hasMore);
  const syncedUntil =
    typeof root?.syncedUntil === "string"
      ? root.syncedUntil
      : typeof cursor?.syncedUntil === "string"
        ? cursor.syncedUntil
        : typeof cursor?.updatedBefore === "string"
          ? cursor.updatedBefore
          : null;

  return {
    hasMore,
    syncedUntil,
  };
}

function hasActiveCampaignPendingContinuation(run: ActiveCampaignSyncRunSummary | null) {
  if (!run || run.status === "failed") return false;
  return parseActiveCampaignSyncCursor(run.metadata).hasMore;
}

function parseAggregateSyncCounters(
  run: ActiveCampaignSyncRunSummary | null,
): SyncCountersSummary {
  const metadata = asRecord(run?.metadata);
  const aggregate = asRecord(metadata?.aggregateCounters);

  return {
    fetchedCount: ensureSyncNumber(aggregate?.fetchedCount ?? metadata?.fetchedCount),
    processedCount: ensureSyncNumber(aggregate?.processedCount ?? run?.processed_count),
    createdCount: ensureSyncNumber(aggregate?.createdCount ?? run?.created_count),
    mergedCount: ensureSyncNumber(aggregate?.mergedCount ?? run?.merged_count),
    skippedCount: ensureSyncNumber(aggregate?.skippedCount ?? run?.skipped_count),
    errorCount: ensureSyncNumber(aggregate?.errorCount ?? run?.error_count),
  };
}

function isActiveCampaignSyncRunStale(run: ActiveCampaignSyncRunSummary | null) {
  if (!run || run.status !== "running" || run.finished_at) return false;

  const startedAtMs = Date.parse(run.started_at);
  if (!Number.isFinite(startedAtMs)) return false;

  return Date.now() - startedAtMs >= ACTIVE_CAMPAIGN_STALE_SYNC_MS;
}

function isActiveCampaignSyncPendingContinuationStale(
  run: ActiveCampaignSyncRunSummary | null,
) {
  if (!run || run.status === "running" || run.status === "failed") return false;
  if (!hasActiveCampaignPendingContinuation(run)) return false;

  const referenceAtMs = Date.parse(run.finished_at ?? run.started_at);
  if (!Number.isFinite(referenceAtMs)) return false;

  return Date.now() - referenceAtMs >= ACTIVE_CAMPAIGN_STALE_SYNC_MS;
}

function buildInterruptedSyncMessage(run: ActiveCampaignSyncRunSummary | null, fallback?: string) {
  if (run?.last_error?.trim()) return run.last_error;
  if (hasActiveCampaignPendingContinuation(run)) {
    return fallback || "A continuacao automática da sincronização foi interrompida antes do próximo lote.";
  }
  return fallback || "A sincronização anterior foi interrompida antes da finalizacao.";
}

function resolveAliasTagIds(
  tags: NamedTagDraft[],
  alias: string,
  availableTags: ActiveCampaignTagOption[],
) {
  const normalizedAlias = normalizeKey(alias);

  return uniqueStrings(
    tags
      .filter((tag) => normalizeKey(tag.alias) === normalizedAlias)
      .map((tag) => {
        const matchedTag = availableTags.find(
          (option) =>
            option.id === tag.tag ||
            normalizeKey(option.name) === normalizeKey(tag.tag),
        );
        return matchedTag?.id ?? tag.tag;
      }),
  );
}

function replaceAliasTags(tags: NamedTagDraft[], alias: string, nextTagIds: string[]) {
  const normalizedAlias = normalizeKey(alias);
  const remainingTags = tags.filter((tag) => normalizeKey(tag.alias) !== normalizedAlias);

  return [
    ...remainingTags,
    ...uniqueStrings(nextTagIds).map((tagId) => ({
      alias,
      tag: tagId,
    })),
  ];
}

function normalizeNamedTagsForCompare(tags: NamedTagDraft[]) {
  return tags
    .map((tag) => ({
      alias: tag.alias.trim(),
      tag: tag.tag.trim(),
    }))
    .filter((tag) => tag.alias && tag.tag)
    .sort((left, right) => {
      const aliasCompare = left.alias.localeCompare(right.alias);
      return aliasCompare || left.tag.localeCompare(right.tag);
    });
}

function namedTagsAreEqual(left: NamedTagDraft[], right: NamedTagDraft[]) {
  return (
    JSON.stringify(normalizeNamedTagsForCompare(left)) ===
    JSON.stringify(normalizeNamedTagsForCompare(right))
  );
}

async function withTimeout<T,>(promise: PromiseLike<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function extractJsonErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const directMessage =
    typeof record.error === "string"
      ? record.error
      : typeof record.message === "string"
        ? record.message
        : null;

  if (directMessage) return directMessage;

  if (record.details && typeof record.details === "object") {
    const detailRecord = record.details as Record<string, unknown>;
    if (typeof detailRecord.message === "string") return detailRecord.message;
    if (typeof detailRecord.error === "string") return detailRecord.error;
  }

  return null;
}

async function extractFunctionInvokeErrorMessage(error: unknown, fallback: string) {
  const defaultMessage = error instanceof Error ? error.message : fallback;

  if (!error || typeof error !== "object" || !("context" in error)) {
    return defaultMessage;
  }

  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) {
    return defaultMessage;
  }

  try {
    const response = context.clone();
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const payload = await response.json();
      const parsedMessage = extractJsonErrorMessage(payload);

      if (parsedMessage) {
        return parsedMessage;
      }
    } else {
      const rawText = (await response.text()).trim();
      if (rawText) {
        return rawText;
      }
    }
  } catch {
    return defaultMessage;
  }

  if (context.status) {
    return `HTTP ${context.status}: ${defaultMessage}`;
  }

  return defaultMessage;
}

function parseCsvText(text: string): ParsedCsvUpload {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(current);
      if (row.some((cell) => cell.trim())) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.trim())) {
    rows.push(row);
  }

  const headers = (rows[0] ?? []).map((header) => header.trim());
  const parsedRows = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index]?.trim() ?? "";
    });

    const firstNameHeader = headers.find((header) => normalizeKey(header) === "firstname");
    const lastNameHeader = headers.find((header) => normalizeKey(header) === "lastname");
    const firstName = firstNameHeader ? record[firstNameHeader]?.trim() : "";
    const lastName = lastNameHeader ? record[lastNameHeader]?.trim() : "";

    if ((firstName || lastName) && !record["Nome completo"]) {
      record["Nome completo"] = [firstName, lastName].filter(Boolean).join(" ").trim();
    }

    return record;
  });

  const finalHeaders = headers.includes("Nome completo")
    ? headers
    : parsedRows.some((parsedRow) => parsedRow["Nome completo"])
      ? [...headers, "Nome completo"]
      : headers;

  return {
    headers: finalHeaders,
    rows: parsedRows,
  };
}

function findCsvColumn(headers: string[], candidates: string[]) {
  const normalizedCandidates = candidates.map(normalizeKey);
  return (
    headers.find((header) => normalizedCandidates.includes(normalizeKey(header))) ||
    headers.find((header) =>
      normalizedCandidates.some((candidate) => normalizeKey(header).includes(candidate)),
    ) ||
    ""
  );
}

function buildDefaultStaticMappings(): CsvColumnMapping[] {
  return [
    { value: "ORG-API", sheetColumn: "UTM SOURCE" },
    { value: "lsl_modelo_utility_v42", sheetColumn: "UTM CONTENT" },
  ];
}

function createEmptyBulkUpdateResponse(mode: BulkCsvMode): GoogleSheetsBulkUpdateResponse {
  return {
    success: true,
    summary: {
      mode,
      receivedRows: 0,
      uniqueIdentities: 0,
      uniqueEmails: 0,
      missingIdentityRows: 0,
      missingEmailRows: 0,
      duplicatedInputIdentities: 0,
      duplicatedInputEmails: 0,
      matchedRows: 0,
      matchedByPhoneRows: 0,
      updatedRows: 0,
      updatedCells: 0,
      missingFromSheetRows: 0,
      insertedFromActive: 0,
      insertedFromCsv: 0,
      activeContactsNotFound: 0,
      activeContactsFoundByPhone: 0,
      activeContactsWithoutCaptureTag: 0,
      activeLookupErrors: 0,
      activeCaptureTagMissing: 0,
      notFoundRows: 0,
      skippedBlankCells: 0,
      skippedUnchangedCells: 0,
      sheetName: "",
      spreadsheetId: "",
      captureTagId: null,
      captureTagName: null,
    },
    notFound: [],
  };
}

function mergeBulkUpdateResponses(
  current: GoogleSheetsBulkUpdateResponse,
  next: GoogleSheetsBulkUpdateResponse,
): GoogleSheetsBulkUpdateResponse {
  return {
    success: current.success && next.success,
    summary: {
      ...next.summary,
      receivedRows: current.summary.receivedRows + next.summary.receivedRows,
      uniqueIdentities:
        current.summary.uniqueIdentities +
        (next.summary.uniqueIdentities ?? next.summary.uniqueEmails),
      uniqueEmails: current.summary.uniqueEmails + next.summary.uniqueEmails,
      missingIdentityRows: current.summary.missingIdentityRows + (next.summary.missingIdentityRows ?? 0),
      missingEmailRows: current.summary.missingEmailRows + next.summary.missingEmailRows,
      duplicatedInputIdentities:
        current.summary.duplicatedInputIdentities +
        (next.summary.duplicatedInputIdentities ?? next.summary.duplicatedInputEmails),
      duplicatedInputEmails: current.summary.duplicatedInputEmails + next.summary.duplicatedInputEmails,
      matchedRows: current.summary.matchedRows + next.summary.matchedRows,
      matchedByPhoneRows: current.summary.matchedByPhoneRows + next.summary.matchedByPhoneRows,
      updatedRows: current.summary.updatedRows + next.summary.updatedRows,
      updatedCells: current.summary.updatedCells + next.summary.updatedCells,
      missingFromSheetRows: current.summary.missingFromSheetRows + next.summary.missingFromSheetRows,
      insertedFromActive: current.summary.insertedFromActive + next.summary.insertedFromActive,
      insertedFromCsv: current.summary.insertedFromCsv + next.summary.insertedFromCsv,
      activeContactsNotFound: current.summary.activeContactsNotFound + next.summary.activeContactsNotFound,
      activeContactsFoundByPhone:
        current.summary.activeContactsFoundByPhone + next.summary.activeContactsFoundByPhone,
      activeContactsWithoutCaptureTag:
        current.summary.activeContactsWithoutCaptureTag + next.summary.activeContactsWithoutCaptureTag,
      activeLookupErrors: current.summary.activeLookupErrors + next.summary.activeLookupErrors,
      activeCaptureTagMissing: current.summary.activeCaptureTagMissing + next.summary.activeCaptureTagMissing,
      notFoundRows: current.summary.notFoundRows + next.summary.notFoundRows,
      skippedBlankCells: current.summary.skippedBlankCells + next.summary.skippedBlankCells,
      skippedUnchangedCells: current.summary.skippedUnchangedCells + next.summary.skippedUnchangedCells,
    },
    notFound: [...current.notFound, ...next.notFound],
  };
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildFrontendPhoneDedupeKey(value: unknown) {
  const rawDigits = String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!rawDigits) return "";

  let localDigits =
    rawDigits.startsWith("55") && [12, 13].includes(rawDigits.length)
      ? rawDigits.slice(2)
      : rawDigits;

  if (/^[1-9]{2}9[6-9]\d{7}$/.test(localDigits)) {
    localDigits = `${localDigits.slice(0, 2)}${localDigits.slice(3)}`;
  }

  if (/^[1-9]{2}9?\d{8}$/.test(localDigits)) {
    return `br:${localDigits}`;
  }

  return `raw:${rawDigits}`;
}

function uniqueRowsByColumn(
  rows: Array<Record<string, string>>,
  column: string,
  phoneColumn = "",
) {
  const rowsByIdentity = new Map<string, Record<string, string>>();
  const emailIdentityKeys = new Map<string, string>();
  const phoneIdentityKeys = new Map<string, string>();
  let duplicateCount = 0;
  let missingEmailRows = 0;
  let missingIdentityRows = 0;

  for (const row of rows) {
    const email = String(row[column] ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      missingEmailRows += 1;
    }

    const phoneKey = phoneColumn ? buildFrontendPhoneDedupeKey(row[phoneColumn]) : "";
    const validEmail = email && email.includes("@") ? email : "";
    const existingIdentityKey =
      (validEmail ? emailIdentityKeys.get(validEmail) : undefined) ||
      (phoneKey ? phoneIdentityKeys.get(phoneKey) : undefined);

    if (existingIdentityKey) {
      duplicateCount += 1;
      continue;
    }

    const identityKey = validEmail ? `email:${validEmail}` : phoneKey ? `phone:${phoneKey}` : "";
    if (!identityKey) {
      missingIdentityRows += 1;
      continue;
    }

    rowsByIdentity.set(identityKey, row);
    if (validEmail) emailIdentityKeys.set(validEmail, identityKey);
    if (phoneKey) phoneIdentityKeys.set(phoneKey, identityKey);
  }

  return {
    rows: [...rowsByIdentity.values()],
    duplicateCount,
    missingEmailRows,
    missingIdentityRows,
  };
}

function escapeCsvValue(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(escapeCsvValue).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(",")),
  ].join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <Badge variant={connected ? "default" : "secondary"}>
      {connected ? "Configurado" : "Não configurado"}
    </Badge>
  );
}

export default function Sources() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();
  const latestLaunchIdRef = useRef<string | null>(null);
  const catalogRequestRef = useRef(0);
  const googleSheetsAutoRequestKeysRef = useRef<Set<string>>(new Set());
  const acNamedTagsRef = useRef<NamedTagDraft[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"active" | "uchat" | "gsheets" | null>(null);
  const [hydratedLaunchId, setHydratedLaunchId] = useState<string | null>(null);

  const [launchSettings, setLaunchSettings] = useState<LaunchSettingsRow | null>(null);
  const [acApiUrl, setAcApiUrl] = useState("");
  const [acApiKey, setAcApiKey] = useState("");
  const [acListId, setAcListId] = useState("");
  const [acNamedTags, setAcNamedTags] = useState<NamedTagDraft[]>([]);
  const [tagBindingsDirty, setTagBindingsDirty] = useState(false);
  const [savingTagBindings, setSavingTagBindings] = useState(false);
  const [uchatWorkspaces, setUchatWorkspaces] = useState<UChatWorkspaceDraft[]>([]);
  const [gsEnabled, setGsEnabled] = useState(false);
  const [gsAuthMode, setGsAuthMode] = useState<GoogleSheetsAuthMode>("oauth");
  const [gsOauthEmail, setGsOauthEmail] = useState("");
  const [gsOauthConnected, setGsOauthConnected] = useState(false);
  const [gsServiceAccountEmail, setGsServiceAccountEmail] = useState("");
  const [gsPrivateKey, setGsPrivateKey] = useState("");
  const [gsSpreadsheetId, setGsSpreadsheetId] = useState("");
  const [gsSpreadsheetTitle, setGsSpreadsheetTitle] = useState("");
  const [gsSheetName, setGsSheetName] = useState("");
  const [gsCaptureTagId, setGsCaptureTagId] = useState("");
  const [gsCaptureTagName, setGsCaptureTagName] = useState("");
  const [gsDefaultProductName, setGsDefaultProductName] = useState("");
  const [gsAvailableSpreadsheets, setGsAvailableSpreadsheets] = useState<
    Array<{
      id: string;
      title: string | null;
      modifiedTime: string | null;
      ownerEmail: string | null;
      ownerName: string | null;
    }>
  >([]);
  const [gsAvailableSheets, setGsAvailableSheets] = useState<Array<{ id: number | null; title: string | null }>>([]);
  const [loadingGoogleSheetsCatalog, setLoadingGoogleSheetsCatalog] = useState(false);
  const [connectingGoogleOauth, setConnectingGoogleOauth] = useState(false);
  const [disconnectingGoogleOauth, setDisconnectingGoogleOauth] = useState(false);
  const [bulkCsvFileName, setBulkCsvFileName] = useState("");
  const [bulkCsvHeaders, setBulkCsvHeaders] = useState<string[]>([]);
  const [bulkCsvRows, setBulkCsvRows] = useState<Array<Record<string, string>>>([]);
  const [bulkEmailColumn, setBulkEmailColumn] = useState("");
  const [bulkCsvMode, setBulkCsvMode] = useState<BulkCsvMode>("fixed_update");
  const [bulkColumnMappings, setBulkColumnMappings] = useState<CsvColumnMapping[]>([]);
  const [bulkUpdatingGoogleSheets, setBulkUpdatingGoogleSheets] = useState(false);
  const [bulkUpdateProgress, setBulkUpdateProgress] = useState<{
    processedRows: number;
    totalRows: number;
    currentBatch: number;
    totalBatches: number;
  } | null>(null);
  const [bulkUpdateResult, setBulkUpdateResult] = useState<GoogleSheetsBulkUpdateResponse | null>(null);
  const [activeCampaignTags, setActiveCampaignTags] = useState<ActiveCampaignTagOption[]>([]);
  const [loadingActiveCampaignTags, setLoadingActiveCampaignTags] = useState(false);
  const [activeCampaignTagsLoadedAt, setActiveCampaignTagsLoadedAt] = useState<string | null>(null);
  const [activeCampaignTagsScopeKey, setActiveCampaignTagsScopeKey] = useState<string | null>(null);
  const [activeCampaignSyncRun, setActiveCampaignSyncRun] = useState<ActiveCampaignSyncRunSummary | null>(null);
  const [syncingActiveCampaign, setSyncingActiveCampaign] = useState(false);
  const [activeCampaignSyncMessage, setActiveCampaignSyncMessage] = useState<string | null>(null);
  const activeLaunchId = activeLaunch?.id ?? null;
  const isHydratedActiveLaunch = hydratedLaunchId === activeLaunchId;

  useEffect(() => {
    latestLaunchIdRef.current = activeLaunchId;
  }, [activeLaunchId]);

  useEffect(() => {
    setBulkCsvFileName("");
    setBulkCsvHeaders([]);
    setBulkCsvRows([]);
    setBulkEmailColumn("");
    setBulkColumnMappings([]);
    setBulkUpdateProgress(null);
    setBulkUpdateResult(null);
  }, [activeLaunchId]);

  useEffect(() => {
    acNamedTagsRef.current = acNamedTags;
  }, [acNamedTags]);

  const visibleLaunchSettings = isHydratedActiveLaunch ? launchSettings : null;
  const visibleAcApiUrl = isHydratedActiveLaunch ? acApiUrl : "";
  const visibleAcApiKey = isHydratedActiveLaunch ? acApiKey : "";
  const visibleAcListId = isHydratedActiveLaunch ? acListId : "";
  const visibleAcNamedTags = isHydratedActiveLaunch ? acNamedTags : [];
  const visibleUchatWorkspaces = isHydratedActiveLaunch ? uchatWorkspaces : [];
  const visibleGsEnabled = isHydratedActiveLaunch ? gsEnabled : false;
  const visibleGsAuthMode = isHydratedActiveLaunch ? gsAuthMode : "oauth";
  const visibleGsOauthEmail = isHydratedActiveLaunch ? gsOauthEmail : "";
  const visibleGsOauthConnected = isHydratedActiveLaunch ? gsOauthConnected : false;
  const visibleGsServiceAccountEmail = isHydratedActiveLaunch ? gsServiceAccountEmail : "";
  const visibleGsPrivateKey = isHydratedActiveLaunch ? gsPrivateKey : "";
  const visibleGsSpreadsheetId = isHydratedActiveLaunch ? gsSpreadsheetId : "";
  const visibleGsSpreadsheetTitle = isHydratedActiveLaunch ? gsSpreadsheetTitle : "";
  const visibleGsSheetName = isHydratedActiveLaunch ? gsSheetName : "";
  const visibleGsCaptureTagId = isHydratedActiveLaunch ? gsCaptureTagId : "";
  const visibleGsCaptureTagName = isHydratedActiveLaunch ? gsCaptureTagName : "";
  const visibleGsDefaultProductName = isHydratedActiveLaunch ? gsDefaultProductName : "";
  const visibleActiveCampaignTags = isHydratedActiveLaunch ? activeCampaignTags : [];
  const visibleActiveCampaignTagsLoadedAt = isHydratedActiveLaunch
    ? activeCampaignTagsLoadedAt
    : null;
  const visibleActiveCampaignSyncRun = isHydratedActiveLaunch ? activeCampaignSyncRun : null;
  const showInitialSourcesLoader = loading && !isHydratedActiveLaunch;
  const visibleGsAvailableSpreadsheets = useMemo(() => {
    const selectedId = visibleGsSpreadsheetId.trim();

    if (!selectedId || gsAvailableSpreadsheets.some((spreadsheet) => spreadsheet.id === selectedId)) {
      return gsAvailableSpreadsheets;
    }

    return [
      {
        id: selectedId,
        title: visibleGsSpreadsheetTitle || selectedId,
        modifiedTime: null,
        ownerEmail: null,
        ownerName: null,
      },
      ...gsAvailableSpreadsheets,
    ];
  }, [gsAvailableSpreadsheets, visibleGsSpreadsheetId, visibleGsSpreadsheetTitle]);
  const visibleGsAvailableSheets = useMemo(() => {
    if (gsAvailableSheets.length > 0) return gsAvailableSheets;

    const fallbackSheetName =
      visibleGsSheetName.trim() ||
      (visibleGsSpreadsheetId.trim() ? DEFAULT_GOOGLE_SHEET_NAME : "");

    return fallbackSheetName ? [{ id: null, title: fallbackSheetName }] : [];
  }, [gsAvailableSheets, visibleGsSheetName, visibleGsSpreadsheetId]);

  const managedAliasKeys = useMemo(
    () => MANAGED_SOURCE_ALIASES.map((binding) => normalizeKey(binding.alias)),
    [],
  );

  const managedSourceBindings = useMemo(
    () =>
      MANAGED_SOURCE_ALIASES.map((binding) => ({
        ...binding,
        selectedTagIds: resolveAliasTagIds(
          visibleAcNamedTags,
          binding.alias,
          visibleActiveCampaignTags,
        ),
      })),
    [visibleAcNamedTags, visibleActiveCampaignTags],
  );

  const advancedNamedTags = useMemo(
    () =>
      visibleAcNamedTags.filter((tag) => !managedAliasKeys.includes(normalizeKey(tag.alias))),
    [managedAliasKeys, visibleAcNamedTags],
  );

  const loadActiveCampaignCatalog = useCallback(
    async (options?: {
      apiUrl?: string;
      apiKey?: string;
      launchId?: string | null;
      silent?: boolean;
    }) => {
      const trimmedApiUrl = (options?.apiUrl ?? acApiUrl).trim();
      const trimmedApiKey = (options?.apiKey ?? acApiKey).trim();
      const requestLaunchId = options?.launchId ?? latestLaunchIdRef.current;

      if (!requestLaunchId) return;

      if (!trimmedApiUrl || !trimmedApiKey) {
        if (latestLaunchIdRef.current === requestLaunchId) {
          setActiveCampaignTags([]);
          setActiveCampaignTagsLoadedAt(null);
          setActiveCampaignTagsScopeKey(null);
        }

        if (!options?.silent) {
          toast({
            title: "Preencha as credenciais do ActiveCampaign",
            description: "Informe a API URL e a API Key para carregar as tags da conta.",
            variant: "destructive",
          });
        }
        return;
      }

      const requestId = catalogRequestRef.current + 1;
      catalogRequestRef.current = requestId;
      setLoadingActiveCampaignTags(true);

      try {
        const { data, error } = await withTimeout(
          supabase.functions.invoke("activecampaign-catalog", {
            body: {
              apiUrl: trimmedApiUrl,
              apiKey: trimmedApiKey,
            },
          }),
          ACTIVECAMPAIGN_CATALOG_TIMEOUT_MS,
          "A consulta ao catalogo do ActiveCampaign demorou demais para responder.",
        );

        const typedData = (data ?? null) as ActiveCampaignCatalogResponse | null;
        if (error || !typedData?.tags) {
          throw new Error(
            error?.message ||
              "Não foi possivel consultar as tags da conta com essas credenciais.",
          );
        }

        if (
          catalogRequestRef.current !== requestId ||
          latestLaunchIdRef.current !== requestLaunchId
        ) {
          return;
        }

        setActiveCampaignTags(typedData.tags);
        setActiveCampaignTagsLoadedAt(typedData.loadedAt ?? new Date().toISOString());
        setActiveCampaignTagsScopeKey(
          buildCatalogScopeKey(requestLaunchId, trimmedApiUrl, trimmedApiKey),
        );

        if (!options?.silent) {
          toast({
            title: "Tags carregadas",
            description: `${typedData.tags.length} tag(s) do ActiveCampaign disponíveis para mapeamento.`,
          });
        }
      } catch (error) {
        const description = await extractFunctionInvokeErrorMessage(
          error,
          "Não foi possivel consultar as tags da conta agora.",
        );

        if (!options?.silent) {
          toast({
            title: "Erro ao carregar tags do ActiveCampaign",
            description,
            variant: "destructive",
          });
        }
      } finally {
        if (
          catalogRequestRef.current === requestId &&
          latestLaunchIdRef.current === requestLaunchId
        ) {
          setLoadingActiveCampaignTags(false);
        }
      }
    },
    [acApiKey, acApiUrl, toast],
  );

  const markActiveCampaignSyncRunAsFailed = useCallback(
    async (
      launchId: string,
      run: ActiveCampaignSyncRunSummary,
      reason: string,
      options?: { silent?: boolean },
    ) => {
      const nextFinishedAt = new Date().toISOString();
      const metadataRecord = asRecord(run.metadata);
      const nextMetadata = {
        ...(metadataRecord ?? {}),
        interruptedAt: nextFinishedAt,
        interruptedReason: reason,
      } satisfies Record<string, unknown>;

      const { data, error } = await supabase
        .from("platform_sync_runs")
        .update({
          status: "failed",
          finished_at: nextFinishedAt,
          last_error: reason,
          error_count: Math.max(run.error_count, 1),
          metadata: nextMetadata as Json,
        })
        .eq("id", run.id)
        .eq("status", "running")
        .select(
          "id, status, processed_count, created_count, merged_count, skipped_count, error_count, started_at, finished_at, last_error, metadata",
        )
        .maybeSingle();

      if (error) {
        if (!options?.silent) {
          toast({
            title: "Erro ao finalizar a sincronização interrompida",
            description: error.message,
            variant: "destructive",
          });
        }

        const fallbackRun: ActiveCampaignSyncRunSummary = {
          ...run,
          status: "failed",
          finished_at: nextFinishedAt,
          last_error: reason,
          error_count: Math.max(run.error_count, 1),
          metadata: nextMetadata as Json,
        };

        if (latestLaunchIdRef.current === launchId) {
          setActiveCampaignSyncRun(fallbackRun);
        }

        return fallbackRun;
      }

      const typedRun = (data as ActiveCampaignSyncRunSummary | null) ?? {
        ...run,
        status: "failed",
        finished_at: nextFinishedAt,
        last_error: reason,
        error_count: Math.max(run.error_count, 1),
        metadata: nextMetadata as Json,
      };

      if (latestLaunchIdRef.current === launchId) {
        setActiveCampaignSyncRun(typedRun);
      }

      return typedRun;
    },
    [toast],
  );

  const markLatestActiveCampaignSyncRunAsFailed = useCallback(
    async (launchId: string, reason: string, options?: { silent?: boolean }) => {
      const { data, error } = await supabase
        .from("platform_sync_runs")
        .select(
          "id, status, processed_count, created_count, merged_count, skipped_count, error_count, started_at, finished_at, last_error, metadata",
        )
        .eq("launch_id", launchId)
        .eq("source", "activecampaign")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (!options?.silent) {
          toast({
            title: "Erro ao verificar a última sincronização",
            description: error.message,
            variant: "destructive",
          });
        }
        return null;
      }

      const typedRun = (data as ActiveCampaignSyncRunSummary | null) ?? null;
      if (!typedRun || typedRun.status !== "running") {
        return typedRun;
      }

      return await markActiveCampaignSyncRunAsFailed(launchId, typedRun, reason, options);
    },
    [markActiveCampaignSyncRunAsFailed, toast],
  );

  const loadLatestActiveCampaignSyncRun = useCallback(
    async (launchId: string, options?: { silent?: boolean }) => {
      const { data, error } = await supabase
        .from("platform_sync_runs")
        .select(
          "id, status, processed_count, created_count, merged_count, skipped_count, error_count, started_at, finished_at, last_error, metadata",
        )
        .eq("launch_id", launchId)
        .eq("source", "activecampaign")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (!options?.silent) {
          toast({
            title: "Erro ao carregar o status da sincronização",
            description: error.message,
            variant: "destructive",
          });
        }
        return null;
      }

      let typedRun = (data as ActiveCampaignSyncRunSummary | null) ?? null;

      if (typedRun && isActiveCampaignSyncRunStale(typedRun)) {
        typedRun = await markActiveCampaignSyncRunAsFailed(
          launchId,
          typedRun,
          buildInterruptedSyncMessage(typedRun),
          { silent: true },
        );
      } else if (typedRun && isActiveCampaignSyncPendingContinuationStale(typedRun)) {
        typedRun = {
          ...typedRun,
          status: "failed",
          last_error: buildInterruptedSyncMessage(typedRun),
          error_count: Math.max(typedRun.error_count, 1),
        };
      }

      if (latestLaunchIdRef.current === launchId) {
        setActiveCampaignSyncRun(typedRun);
      }

      return typedRun;
    },
    [markActiveCampaignSyncRunAsFailed, toast],
  );

  const activeConnected = useMemo(
    () => Boolean(visibleAcApiUrl.trim() && visibleAcApiKey.trim()),
    [visibleAcApiKey, visibleAcApiUrl],
  );
  const activeCampaignSyncCounters = useMemo(
    () => parseAggregateSyncCounters(visibleActiveCampaignSyncRun),
    [visibleActiveCampaignSyncRun],
  );
  const activeCampaignSyncCursor = useMemo(
    () => parseActiveCampaignSyncCursor(visibleActiveCampaignSyncRun?.metadata ?? null),
    [visibleActiveCampaignSyncRun],
  );
  const activeCampaignSyncHasPendingContinuation = useMemo(
    () => hasActiveCampaignPendingContinuation(visibleActiveCampaignSyncRun),
    [visibleActiveCampaignSyncRun],
  );
  const activeCampaignSyncIsStale = useMemo(
    () =>
      isActiveCampaignSyncRunStale(visibleActiveCampaignSyncRun) ||
      isActiveCampaignSyncPendingContinuationStale(visibleActiveCampaignSyncRun),
    [visibleActiveCampaignSyncRun],
  );
  const activeCampaignSyncIsRunning = useMemo(
    () =>
      syncingActiveCampaign ||
      Boolean(
        (visibleActiveCampaignSyncRun?.status === "running" ||
          activeCampaignSyncHasPendingContinuation) &&
          !activeCampaignSyncIsStale,
      ),
    [
      activeCampaignSyncHasPendingContinuation,
      activeCampaignSyncIsStale,
      syncingActiveCampaign,
      visibleActiveCampaignSyncRun?.status,
    ],
  );
  const activeCampaignSyncBadgeLabel = useMemo(() => {
    if (activeCampaignSyncIsRunning) return "Sincronizando";
    if (visibleActiveCampaignSyncRun?.status === "failed" || activeCampaignSyncIsStale) return "Falhou";
    if (visibleActiveCampaignSyncRun) return "Sincronizado";
    return "Aguardando";
  }, [activeCampaignSyncIsRunning, activeCampaignSyncIsStale, visibleActiveCampaignSyncRun]);
  const activeCampaignSyncLastError = useMemo(() => {
    if (visibleActiveCampaignSyncRun?.last_error?.trim()) {
      return visibleActiveCampaignSyncRun.last_error;
    }

    if (activeCampaignSyncIsStale) {
      return buildInterruptedSyncMessage(visibleActiveCampaignSyncRun);
    }

    return null;
  }, [activeCampaignSyncIsStale, visibleActiveCampaignSyncRun]);
  const activeCampaignSyncStatusMessage = useMemo(() => {
    if (activeCampaignSyncMessage) return activeCampaignSyncMessage;

    if (!visibleActiveCampaignSyncRun) {
      return "A base sera sincronizada automaticamente depois que as credenciais forem salvas.";
    }

    if (activeCampaignSyncIsRunning) {
      return activeCampaignSyncCursor.hasMore
        ? `Sincronizando contatos no backend... ${activeCampaignSyncCounters.processedCount} contato(s) tratados até agora. A fila continua mesmo se você trocar de tela ou fechar a aba.`
        : "Sincronização em andamento no backend.";
    }

    return "A última sincronização da conta já foi registrada no backend.";
  }, [
    activeCampaignSyncCounters.processedCount,
    activeCampaignSyncCursor.hasMore,
    activeCampaignSyncIsRunning,
    activeCampaignSyncMessage,
    visibleActiveCampaignSyncRun,
  ]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeLaunchId) {
        setLaunchSettings(null);
        setAcApiUrl("");
        setAcApiKey("");
        setAcListId("");
        setAcNamedTags([]);
        setTagBindingsDirty(false);
        setSavingTagBindings(false);
        setUchatWorkspaces([]);
        setGsEnabled(false);
        setGsAuthMode("oauth");
        setGsOauthEmail("");
        setGsOauthConnected(false);
        setGsServiceAccountEmail("");
        setGsPrivateKey("");
        setGsSpreadsheetId("");
        setGsSpreadsheetTitle("");
        setGsSheetName("");
        setGsCaptureTagId("");
        setGsCaptureTagName("");
        setGsDefaultProductName("");
        setGsAvailableSpreadsheets([]);
        setGsAvailableSheets([]);
        setLoadingGoogleSheetsCatalog(false);
        setConnectingGoogleOauth(false);
        setDisconnectingGoogleOauth(false);
        setActiveCampaignTags([]);
        setActiveCampaignTagsLoadedAt(null);
        setActiveCampaignTagsScopeKey(null);
        setActiveCampaignSyncRun(null);
        setSyncingActiveCampaign(false);
        setActiveCampaignSyncMessage(null);
        setHydratedLaunchId(null);
        setLoadingActiveCampaignTags(false);
        setLoading(false);
        return;
      }

      const launchId = activeLaunchId;
      const draft = parseSourcesDraft(localStorage.getItem(buildSourcesDraftKey(launchId)));
      catalogRequestRef.current += 1;
      setLaunchSettings(null);
      setTagBindingsDirty(false);
      setSavingTagBindings(false);
      setAcApiUrl(draft?.acApiUrl ?? "");
      setAcApiKey(draft?.acApiKey ?? "");
      setAcListId(draft?.acListId ?? "");
      setAcNamedTags(draft?.acNamedTags ?? []);
      setUchatWorkspaces(draft?.uchatWorkspaces ?? []);
      setGsEnabled(draft?.gsEnabled ?? false);
      setGsAuthMode(normalizeGoogleSheetsAuthMode(draft?.gsAuthMode ?? "oauth"));
      setGsOauthEmail(draft?.gsOauthEmail ?? "");
      setGsOauthConnected(draft?.gsOauthConnected ?? false);
      setGsServiceAccountEmail(draft?.gsServiceAccountEmail ?? "");
      setGsPrivateKey(draft?.gsPrivateKey ?? "");
      setGsSpreadsheetId(draft?.gsSpreadsheetId ?? "");
      setGsSpreadsheetTitle(draft?.gsSpreadsheetTitle ?? "");
      setGsSheetName(draft?.gsSheetName ?? "");
      setGsCaptureTagId(draft?.gsCaptureTagId ?? "");
      setGsCaptureTagName(draft?.gsCaptureTagName ?? "");
      setGsDefaultProductName(draft?.gsDefaultProductName ?? "");
      setGsAvailableSpreadsheets([]);
      setGsAvailableSheets([]);
      setLoadingGoogleSheetsCatalog(false);
      setConnectingGoogleOauth(false);
      setDisconnectingGoogleOauth(false);
      setActiveCampaignTags([]);
      setActiveCampaignTagsLoadedAt(null);
      setActiveCampaignTagsScopeKey(null);
      setActiveCampaignSyncRun(null);
      setSyncingActiveCampaign(false);
      setActiveCampaignSyncMessage(null);
      setLoadingActiveCampaignTags(false);
      setLoading(true);
      setHydratedLaunchId(draft ? launchId : null);

      const { data: sourcesPayload, error: sourcesError } = await supabase.rpc(
        "get_launch_sources",
        { target_launch_id: launchId },
      );

      if (cancelled || latestLaunchIdRef.current !== launchId) {
        return;
      }

      const parsedPayload = (sourcesPayload ?? null) as unknown as LaunchSourcesPayload | null;
      const launchData = parsedPayload?.launch ?? null;
      const workspaceData = parsedPayload?.uchat_workspaces ?? [];

      if (sourcesError || !launchData) {
        toast({
          title: "Erro ao carregar as fontes",
          description:
            sourcesError?.message ||
            "Não foi possivel carregar as configurações do expert.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const typedLaunch = launchData as LaunchSettingsRow;
      const remoteUchatWorkspaces = ((workspaceData || []) as Array<Record<string, unknown>>).map(
        (workspace) => ({
          id: typeof workspace.id === "string" ? workspace.id : undefined,
          workspace_name:
            typeof workspace.workspace_name === "string" ? workspace.workspace_name : "",
          workspace_id: typeof workspace.workspace_id === "string" ? workspace.workspace_id : "",
          api_token: typeof workspace.api_token === "string" ? workspace.api_token : "",
          welcome_subflow_ns:
            typeof workspace.welcome_subflow_ns === "string"
              ? workspace.welcome_subflow_ns
              : "",
          default_tag_name:
            typeof workspace.default_tag_name === "string" ? workspace.default_tag_name : "",
        }),
      );
      setLaunchSettings(typedLaunch);
      const remoteNamedTags = Array.isArray(typedLaunch.ac_named_tags)
        ? (typedLaunch.ac_named_tags as NamedTagDraft[])
        : [];
      const nextNamedTags = draft?.acNamedTags ?? remoteNamedTags;
      setAcApiUrl(draft?.acApiUrl ?? typedLaunch.ac_api_url ?? "");
      setAcApiKey(draft?.acApiKey ?? typedLaunch.ac_api_key ?? "");
      setAcListId(draft?.acListId ?? typedLaunch.ac_default_list_id ?? "");
      setAcNamedTags(nextNamedTags);
      setTagBindingsDirty(Boolean(draft?.acNamedTags && !namedTagsAreEqual(draft.acNamedTags, remoteNamedTags)));
      setUchatWorkspaces(draft?.uchatWorkspaces ?? remoteUchatWorkspaces);
      setGsEnabled(draft?.gsEnabled ?? typedLaunch.gs_enabled ?? false);
      setGsAuthMode(
        normalizeGoogleSheetsAuthMode(draft?.gsAuthMode ?? typedLaunch.gs_auth_mode ?? "oauth"),
      );
      setGsOauthEmail(typedLaunch.gs_oauth_email ?? "");
      setGsOauthConnected(Boolean(typedLaunch.gs_oauth_connected));
      setGsServiceAccountEmail(
        draft?.gsServiceAccountEmail ?? typedLaunch.gs_service_account_email ?? "",
      );
      setGsPrivateKey(draft?.gsPrivateKey ?? typedLaunch.gs_private_key ?? "");
      setGsSpreadsheetId(draft?.gsSpreadsheetId ?? typedLaunch.gs_spreadsheet_id ?? "");
      setGsSpreadsheetTitle(
        draft?.gsSpreadsheetTitle ?? typedLaunch.gs_spreadsheet_title ?? "",
      );
      setGsSheetName(draft?.gsSheetName ?? typedLaunch.gs_sheet_name ?? "");
      setGsCaptureTagId(draft?.gsCaptureTagId ?? typedLaunch.gs_capture_tag_id ?? "");
      setGsCaptureTagName(draft?.gsCaptureTagName ?? typedLaunch.gs_capture_tag_name ?? "");
      setGsDefaultProductName(
        draft?.gsDefaultProductName ?? typedLaunch.gs_default_product_name ?? "",
      );
      setHydratedLaunchId(launchId);
      setLoading(false);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeLaunchId, toast]);

  useEffect(() => {
    if (!activeLaunchId || loading || hydratedLaunchId !== activeLaunchId) return;

    const currentApiUrl = visibleAcApiUrl.trim();
    const currentApiKey = visibleAcApiKey.trim();

    if (!currentApiUrl || !currentApiKey) {
      setActiveCampaignTags([]);
      setActiveCampaignTagsLoadedAt(null);
      setActiveCampaignTagsScopeKey(null);
      return;
    }

    const nextScopeKey = buildCatalogScopeKey(activeLaunchId, currentApiUrl, currentApiKey);

    if (
      activeCampaignTagsScopeKey === nextScopeKey &&
      (visibleActiveCampaignTags.length > 0 || Boolean(visibleActiveCampaignTagsLoadedAt))
    ) {
      return;
    }

    if (loadingActiveCampaignTags) return;

    void loadActiveCampaignCatalog({
      apiUrl: currentApiUrl,
      apiKey: currentApiKey,
      launchId: activeLaunchId,
      silent: true,
    });
  }, [
    activeLaunchId,
    activeCampaignTagsScopeKey,
    hydratedLaunchId,
    loadActiveCampaignCatalog,
    loadingActiveCampaignTags,
    loading,
    visibleAcApiKey,
    visibleAcApiUrl,
    visibleActiveCampaignTags.length,
    visibleActiveCampaignTagsLoadedAt,
  ]);

  useEffect(() => {
    if (!activeLaunchId || loading || hydratedLaunchId !== activeLaunchId) return;

    localStorage.setItem(
      buildSourcesDraftKey(activeLaunchId),
      JSON.stringify({
        acApiUrl,
        acApiKey,
        acListId,
        acNamedTags,
        uchatWorkspaces,
        gsEnabled,
        gsAuthMode,
        gsOauthEmail,
        gsOauthConnected,
        gsServiceAccountEmail,
        gsPrivateKey,
        gsSpreadsheetId,
        gsSpreadsheetTitle,
        gsSheetName,
        gsCaptureTagId,
        gsCaptureTagName,
        gsDefaultProductName,
      } satisfies SourcesDraft),
    );
  }, [
    activeLaunchId,
    loading,
    hydratedLaunchId,
    acApiUrl,
    acApiKey,
    acListId,
    acNamedTags,
    uchatWorkspaces,
    gsEnabled,
    gsAuthMode,
    gsOauthEmail,
    gsOauthConnected,
    gsServiceAccountEmail,
    gsPrivateKey,
    gsSpreadsheetId,
    gsSpreadsheetTitle,
    gsSheetName,
    gsCaptureTagId,
    gsCaptureTagName,
    gsDefaultProductName,
  ]);

  useEffect(() => {
    if (
      !tagBindingsDirty ||
      !activeLaunchId ||
      loading ||
      hydratedLaunchId !== activeLaunchId ||
      savingTagBindings
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const launchId = activeLaunchId;
      const tagsSnapshot = acNamedTagsRef.current;
      const serializedSnapshot = JSON.stringify(normalizeNamedTagsForCompare(tagsSnapshot));

      const saveTagBindings = async () => {
        setSavingTagBindings(true);

        const { error, data } = await supabase.rpc("update_launch_activecampaign_settings", {
          target_launch_id: launchId,
          next_api_url: acApiUrl || null,
          next_api_key: acApiKey || null,
          next_default_list_id: acListId || null,
          next_named_tags: tagsSnapshot as unknown as Json,
        });

        if (latestLaunchIdRef.current !== launchId) {
          return;
        }

        if (error || !data) {
          setTagBindingsDirty(false);
          toast({
            title: "Erro ao salvar tags do ActiveCampaign",
            description:
              error?.message ||
              "O backend nao confirmou a atualizacao automatica das tags.",
            variant: "destructive",
          });
          return;
        }

        setLaunchSettings(data as unknown as LaunchSettingsRow);
        setHydratedLaunchId(launchId);

        const currentSerialized = JSON.stringify(
          normalizeNamedTagsForCompare(acNamedTagsRef.current),
        );

        if (currentSerialized === serializedSnapshot) {
          setTagBindingsDirty(false);
        }
      };

      void saveTagBindings().finally(() => {
        if (latestLaunchIdRef.current === launchId) {
          setSavingTagBindings(false);
        }
      });
    }, 700);

    return () => window.clearTimeout(timeoutId);
  }, [
    acApiKey,
    acApiUrl,
    acListId,
    activeLaunchId,
    hydratedLaunchId,
    loading,
    savingTagBindings,
    tagBindingsDirty,
    toast,
  ]);

  const uchatConnected = useMemo(
    () =>
      visibleUchatWorkspaces.some(
        (workspace) => workspace.workspace_id.trim() && workspace.api_token.trim(),
      ),
    [visibleUchatWorkspaces],
  );
  const googleSheetsConnected = useMemo(
    () => {
      if (visibleGsAuthMode === "oauth") {
        return Boolean(visibleGsOauthConnected);
      }

      return Boolean(
        visibleGsServiceAccountEmail.trim() &&
          visibleGsPrivateKey.trim(),
      );
    },
    [
      visibleGsAuthMode,
      visibleGsOauthConnected,
      visibleGsPrivateKey,
      visibleGsServiceAccountEmail,
    ],
  );

  const updateManagedSourceTags = (alias: string, tagId: string, checked: boolean) => {
    setAcNamedTags((currentTags) => {
      const selectedTagIds = resolveAliasTagIds(
        currentTags,
        alias,
        visibleActiveCampaignTags,
      );
      const nextTagIds = checked
        ? [...selectedTagIds, tagId]
        : selectedTagIds.filter((currentTagId) => currentTagId !== tagId);

      return replaceAliasTags(currentTags, alias, nextTagIds);
    });
    setTagBindingsDirty(true);
  };

  const updateAdvancedNamedTags = (nextAdvancedTags: NamedTagDraft[]) => {
    setAcNamedTags((currentTags) => {
      const managedTags = currentTags.filter((tag) =>
        managedAliasKeys.includes(normalizeKey(tag.alias)),
      );
      return [...managedTags, ...nextAdvancedTags];
    });
    setTagBindingsDirty(true);
  };

  const loadGoogleSheetsCatalog = useCallback(
    async (options?: {
      launchId?: string | null;
      authMode?: GoogleSheetsAuthMode;
      oauthConnected?: boolean;
      serviceAccountEmail?: string;
      privateKey?: string;
      spreadsheetId?: string;
      listOnly?: boolean;
      silent?: boolean;
    }) => {
      const requestLaunchId = options?.launchId ?? activeLaunchId;
      const authMode = normalizeGoogleSheetsAuthMode(options?.authMode ?? gsAuthMode);
      const oauthConnected = options?.oauthConnected ?? gsOauthConnected;
      const serviceAccountEmail = (options?.serviceAccountEmail ?? gsServiceAccountEmail).trim();
      const privateKey = (options?.privateKey ?? gsPrivateKey).trim();
      const spreadsheetId = (options?.spreadsheetId ?? gsSpreadsheetId).trim();
      const listOnly = Boolean(options?.listOnly);

      if (!requestLaunchId) return;

      if (authMode === "service_account" && (!serviceAccountEmail || !privateKey)) {
        if (!options?.silent) {
          toast({
            title: "Preencha a conexão do Google Sheets",
            description:
              "Informe o e-mail da service account, a chave privada e o ID da planilha para carregar as abas.",
            variant: "destructive",
          });
        }
        return;
      }

      if (authMode === "oauth" && !oauthConnected) {
        if (!options?.silent) {
          toast({
            title: "Conecte sua conta Google",
            description: "Entre com o Google antes de listar as planilhas disponíveis.",
            variant: "destructive",
          });
        }
        return;
      }

      setLoadingGoogleSheetsCatalog(true);

      try {
        const { data, error } = await withTimeout(
          supabase.functions.invoke("google-sheets-catalog", {
            body: {
              launchId: requestLaunchId,
              ...(authMode === "service_account"
                ? {
                    serviceAccountEmail,
                    privateKey,
                  }
                : {}),
              ...(spreadsheetId ? { spreadsheetId } : {}),
              ...(listOnly ? { listOnly: true } : {}),
            },
          }),
          15000,
          "O Google Sheets demorou demais para responder.",
        );

        const typedData = (data as GoogleSheetsCatalogResponse | null) ?? null;
        if (error || !typedData) {
          throw new Error(error?.message || "Não foi possivel carregar as abas da planilha.");
        }

        setGsAuthMode(typedData.authMode ?? authMode);
        setGsOauthEmail(typedData.connectionEmail ?? "");
        setGsOauthConnected(Boolean(typedData.authMode === "oauth" && typedData.connectionEmail));
        const nextSpreadsheets = typedData.spreadsheets ?? [];
        setGsAvailableSpreadsheets((currentSpreadsheets) =>
          listOnly || nextSpreadsheets.length > 0 ? nextSpreadsheets : currentSpreadsheets,
        );
        if (!listOnly) {
          setGsSpreadsheetTitle((currentTitle) =>
            typedData.selectedSpreadsheetTitle ?? currentTitle,
          );
          setGsSpreadsheetId((currentSpreadsheetId) =>
            typedData.selectedSpreadsheetId ?? currentSpreadsheetId,
          );
        }
        const returnedSheets = typedData.sheets.map((sheet) => ({
          id: sheet.id,
          title: sheet.title,
        }));
        const fallbackSheets =
          !listOnly && spreadsheetId && returnedSheets.length === 0
            ? [
                {
                  id: null,
                  title: gsSheetName.trim() || DEFAULT_GOOGLE_SHEET_NAME,
                },
              ]
            : [];
        const nextSheets = returnedSheets.length > 0 ? returnedSheets : fallbackSheets;

        setGsAvailableSheets(nextSheets);

        if (!listOnly) {
          const firstSheetName =
            nextSheets.find((sheet) => typeof sheet.title === "string" && sheet.title.trim())
              ?.title ?? "";

          setGsSheetName((currentSheetName) =>
            currentSheetName.trim() ? currentSheetName : firstSheetName,
          );
        }

        if (!listOnly && typedData.catalogWarning && !options?.silent) {
          toast({
            title: "Aba não listada pelo Google",
            description:
              "A planilha foi selecionada, mas o Google não devolveu as abas. Usei a aba padrão Página1 para permitir salvar.",
          });
        }

        if (!options?.silent) {
          toast({
            title: "Google Sheets conectado",
            description:
              listOnly
                ? `${typedData.spreadsheets.length} planilha(s) carregada(s) da conta Google.`
                : typedData.selectedSpreadsheetTitle
                  ? `Planilha "${typedData.selectedSpreadsheetTitle}" pronta com ${typedData.sheets.length} aba(s).`
                  : `${typedData.spreadsheets.length} planilha(s) carregada(s) da conta Google.`,
          });
        }
      } catch (error) {
        const description = await extractFunctionInvokeErrorMessage(
          error,
          "Não foi possivel validar a planilha informada.",
        );

        if (!options?.silent) {
          toast({
            title: "Erro ao carregar abas do Google Sheets",
            description,
            variant: "destructive",
          });
        }
      } finally {
        setLoadingGoogleSheetsCatalog(false);
      }
    },
    [
      activeLaunchId,
      gsAuthMode,
      gsOauthConnected,
      gsPrivateKey,
      gsServiceAccountEmail,
      gsSheetName,
      gsSpreadsheetId,
      toast,
    ],
  );

  useEffect(() => {
    if (!activeLaunchId || loading || hydratedLaunchId !== activeLaunchId) return;
    if (loadingGoogleSheetsCatalog) return;

    const startAutoRequest = (key: string) => {
      if (googleSheetsAutoRequestKeysRef.current.has(key)) return false;
      googleSheetsAutoRequestKeysRef.current.add(key);
      return true;
    };

    if (
      visibleGsAuthMode === "oauth" &&
      visibleGsOauthConnected &&
      gsAvailableSpreadsheets.length === 0
    ) {
      const requestKey = `oauth:list:${activeLaunchId}`;
      if (!startAutoRequest(requestKey)) return;
      void loadGoogleSheetsCatalog({
        launchId: activeLaunchId,
        authMode: "oauth",
        oauthConnected: true,
        spreadsheetId: "",
        listOnly: true,
        silent: true,
      });
      return;
    }

    if (
      visibleGsAuthMode === "oauth" &&
      visibleGsOauthConnected &&
      visibleGsSpreadsheetId.trim() &&
      gsAvailableSheets.length === 0
    ) {
      const requestKey = `oauth:sheets:${activeLaunchId}:${visibleGsSpreadsheetId.trim()}`;
      if (!startAutoRequest(requestKey)) return;
      void loadGoogleSheetsCatalog({
        launchId: activeLaunchId,
        authMode: "oauth",
        oauthConnected: true,
        spreadsheetId: visibleGsSpreadsheetId,
        silent: true,
      });
      return;
    }

    if (
      visibleGsAuthMode === "service_account" &&
      visibleGsServiceAccountEmail.trim() &&
      visibleGsPrivateKey.trim() &&
      visibleGsSpreadsheetId.trim() &&
      gsAvailableSheets.length === 0
    ) {
      const requestKey = `service:sheets:${activeLaunchId}:${visibleGsServiceAccountEmail.trim()}:${visibleGsSpreadsheetId.trim()}`;
      if (!startAutoRequest(requestKey)) return;
      void loadGoogleSheetsCatalog({
        launchId: activeLaunchId,
        authMode: "service_account",
        serviceAccountEmail: visibleGsServiceAccountEmail,
        privateKey: visibleGsPrivateKey,
        spreadsheetId: visibleGsSpreadsheetId,
        silent: true,
      });
    }
  }, [
    activeLaunchId,
    gsAvailableSheets.length,
    gsAvailableSpreadsheets.length,
    hydratedLaunchId,
    loadGoogleSheetsCatalog,
    loading,
    loadingGoogleSheetsCatalog,
    visibleGsAuthMode,
    visibleGsOauthConnected,
    visibleGsPrivateKey,
    visibleGsServiceAccountEmail,
    visibleGsSpreadsheetId,
  ]);

  useEffect(() => {
    googleSheetsAutoRequestKeysRef.current = new Set();
  }, [
    activeLaunchId,
    hydratedLaunchId,
    visibleGsAuthMode,
    visibleGsOauthConnected,
    visibleGsSpreadsheetId,
  ]);

  const handleBulkCsvFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setBulkUpdateProgress(null);
    setBulkUpdateResult(null);

    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({
        title: "Arquivo inválido",
        description: "Envie um arquivo CSV para atualizar a planilha de captura.",
        variant: "destructive",
      });
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseCsvText(text);
      const emailColumn = findCsvColumn(parsed.headers, ["email", "e-mail"]);

      if (!emailColumn) {
        throw new Error("O CSV precisa ter uma coluna de email para localizar as pessoas na captura.");
      }

      setBulkCsvFileName(file.name);
      setBulkCsvHeaders(parsed.headers);
      setBulkCsvRows(parsed.rows);
      setBulkEmailColumn(emailColumn);
      setBulkColumnMappings(buildDefaultStaticMappings());

      toast({
        title: "CSV carregado",
        description: `${parsed.rows.length} linha(s) lida(s). Revise as colunas antes de atualizar a planilha.`,
      });
    } catch (error) {
      setBulkCsvFileName("");
      setBulkCsvHeaders([]);
      setBulkCsvRows([]);
      setBulkEmailColumn("");
      setBulkColumnMappings([]);
      setBulkUpdateProgress(null);
      toast({
        title: "Erro ao ler CSV",
        description: error instanceof Error ? error.message : "Não foi possível interpretar o arquivo.",
        variant: "destructive",
      });
    } finally {
      event.target.value = "";
    }
  };

  const updateBulkColumnMapping = (
    index: number,
    field: keyof CsvColumnMapping,
    value: string,
  ) => {
    setBulkColumnMappings((currentMappings) =>
      currentMappings.map((mapping, mappingIndex) =>
        mappingIndex === index ? { ...mapping, [field]: value } : mapping,
      ),
    );
    setBulkUpdateProgress(null);
    setBulkUpdateResult(null);
  };

  const addBulkColumnMapping = () => {
    setBulkColumnMappings((currentMappings) => [
      ...currentMappings,
      {
        value: "",
        sheetColumn: "UTM SOURCE",
      },
    ]);
    setBulkUpdateProgress(null);
    setBulkUpdateResult(null);
  };

  const removeBulkColumnMapping = (index: number) => {
    setBulkColumnMappings((currentMappings) =>
      currentMappings.filter((_, mappingIndex) => mappingIndex !== index),
    );
    setBulkUpdateProgress(null);
    setBulkUpdateResult(null);
  };

  const runGoogleSheetsBulkUpdate = async () => {
    if (!activeLaunchId) return;

    const isActiveCsvImport = bulkCsvMode === "active_export_import";
    const validMappings = isActiveCsvImport
      ? []
      : bulkColumnMappings.filter((mapping) => mapping.value.trim() && mapping.sheetColumn.trim());

    if (!googleSheetsConnected) {
      toast({
        title: "Google Sheets não configurado",
        description: "Conecte e salve a planilha de captura antes de atualizar por CSV.",
        variant: "destructive",
      });
      return;
    }

    if (!bulkEmailColumn || bulkCsvRows.length === 0 || (!isActiveCsvImport && validMappings.length === 0)) {
      toast({
        title: "Revise o CSV e os mapeamentos",
        description: isActiveCsvImport
          ? "Escolha a coluna de email do CSV exportado do ActiveCampaign."
          : "Escolha a coluna de email e ao menos um valor fixo para aplicar.",
        variant: "destructive",
      });
      return;
    }

    setBulkUpdatingGoogleSheets(true);
    setBulkUpdateResult(null);

    try {
      const phoneColumn = findCsvColumn(bulkCsvHeaders, [
        "telefone",
        "numero de telefone",
        "número de telefone",
        "numero telefone",
        "número telefone",
        "phone",
        "phone number",
        "contact phone",
        "celular",
        "mobile",
        "whatsapp",
      ]);
      const preparedCsvRows = uniqueRowsByColumn(bulkCsvRows, bulkEmailColumn, phoneColumn);
      const batchSize = isActiveCsvImport ? ACTIVE_CSV_IMPORT_BATCH_SIZE : FIXED_UPDATE_BATCH_SIZE;
      const batches = chunkArray(preparedCsvRows.rows, batchSize);

      if (batches.length === 0) {
        throw new Error("Nenhuma linha com email ou telefone utilizável foi encontrada no CSV.");
      }

      let mergedResult = createEmptyBulkUpdateResponse(bulkCsvMode);
      mergedResult.summary.missingIdentityRows = preparedCsvRows.missingIdentityRows;
      mergedResult.summary.duplicatedInputIdentities = preparedCsvRows.duplicateCount;

      let processedRows = preparedCsvRows.missingIdentityRows + preparedCsvRows.duplicateCount;
      setBulkUpdateProgress({
        processedRows,
        totalRows: bulkCsvRows.length,
        currentBatch: 0,
        totalBatches: batches.length,
      });

      for (const [batchIndex, batchRows] of batches.entries()) {
        const { data, error } = await withTimeout(
          supabase.functions.invoke("google-sheets-bulk-update", {
            body: {
              launchId: activeLaunchId,
              emailColumn: bulkEmailColumn,
              mode: bulkCsvMode,
              mappings: validMappings,
              rows: batchRows,
              skipBlankValues: true,
            },
          }),
          60000,
          "A atualização em lote no Google Sheets demorou demais para responder.",
        );

        const typedData = (data as GoogleSheetsBulkUpdateResponse | null) ?? null;
        if (error || !typedData?.success) {
          throw error ?? new Error(`O backend não confirmou o lote ${batchIndex + 1}.`);
        }

        mergedResult = mergeBulkUpdateResponses(mergedResult, typedData);
        processedRows = Math.min(bulkCsvRows.length, processedRows + batchRows.length);

        setBulkUpdateProgress({
          processedRows,
          totalRows: bulkCsvRows.length,
          currentBatch: batchIndex + 1,
          totalBatches: batches.length,
        });
        setBulkUpdateResult(mergedResult);
      }

      setBulkUpdateProgress({
        processedRows: bulkCsvRows.length,
        totalRows: bulkCsvRows.length,
        currentBatch: batches.length,
        totalBatches: batches.length,
      });

      setBulkUpdateResult(mergedResult);
      toast({
        title: "Atualização em lote concluída",
        description: isActiveCsvImport
          ? `${mergedResult.summary.insertedFromCsv} linha(s) inserida(s), ${mergedResult.summary.updatedRows} linha(s) completada(s) e ${mergedResult.summary.matchedRows} já existia(m) na captura.`
          : `${mergedResult.summary.updatedRows} linha(s) atualizada(s), ${mergedResult.summary.insertedFromActive} inserida(s) via ActiveCampaign e ${mergedResult.summary.notFoundRows} alerta(s).`,
        variant: mergedResult.summary.notFoundRows > 0 ? "default" : undefined,
      });
    } catch (error) {
      const description = await extractFunctionInvokeErrorMessage(
        error,
        "Não foi possível atualizar a planilha por CSV.",
      );

      toast({
        title: "Erro na atualização em lote",
        description,
        variant: "destructive",
      });
    } finally {
      setBulkUpdatingGoogleSheets(false);
    }
  };

  const connectGoogleSheetsOauth = useCallback(async () => {
    if (!activeLaunch) return;

    if (!GOOGLE_OAUTH_CLIENT_ID) {
      toast({
        title: "Client ID do Google ausente",
        description:
          "Configure VITE_GOOGLE_OAUTH_CLIENT_ID no frontend antes de conectar a conta Google.",
        variant: "destructive",
      });
      return;
    }

    setConnectingGoogleOauth(true);

    try {
      await ensureGoogleIdentityScript();

      const oauthApi = window.google?.accounts?.oauth2;
      if (!oauthApi?.initCodeClient) {
        throw new Error("O login do Google não ficou disponível neste navegador.");
      }

      const exchangeResponse = await new Promise<GoogleOauthExchangeResponse>((resolve, reject) => {
        const client = oauthApi.initCodeClient({
          client_id: GOOGLE_OAUTH_CLIENT_ID,
          scope: GOOGLE_OAUTH_SCOPES,
          ux_mode: "popup",
          access_type: "offline",
          redirect_uri: window.location.origin,
          select_account: true,
          prompt: "consent",
          include_granted_scopes: true,
          callback: async (response: { code?: string; error?: string }) => {
            if (!response?.code) {
              reject(new Error(response?.error || "O Google não retornou o codigo de autorizacao."));
              return;
            }

            try {
              const { data, error } = await supabase.functions.invoke("google-oauth-exchange", {
                body: {
                  launchId: activeLaunch.id,
                  code: response.code,
                  redirectUri: window.location.origin,
                },
                headers: {
                  "x-requested-with": "XMLHttpRequest",
                },
              });

              const typedData = (data as GoogleOauthExchangeResponse | null) ?? null;
              if (error || !typedData?.launch) {
                throw error ?? new Error("Não foi possivel concluir a conexão com o Google.");
              }

              resolve(typedData);
            } catch (error) {
              reject(error);
            }
          },
          error_callback: (response: { type?: string }) => {
            reject(
              new Error(
                response?.type === "popup_closed"
                  ? "A janela de login do Google foi fechada antes da autorizacao."
                  : "O login do Google não foi concluído.",
              ),
            );
          },
        });

        client.requestCode();
      });

      setLaunchSettings(exchangeResponse.launch);
      setHydratedLaunchId(activeLaunch.id);
      setGsAuthMode("oauth");
      setGsOauthEmail(exchangeResponse.email ?? "");
      setGsOauthConnected(Boolean(exchangeResponse.connected));
      setGsSpreadsheetId("");
      setGsSpreadsheetTitle("");
      setGsSheetName("");
      setGsAvailableSpreadsheets([]);
      setGsAvailableSheets([]);

      toast({
        title: "Conta Google conectada",
        description: exchangeResponse.email
          ? `A conta ${exchangeResponse.email} já pode listar as planilhas disponíveis.`
          : "A conta Google foi conectada com sucesso.",
      });

      await loadGoogleSheetsCatalog({
        launchId: activeLaunch.id,
        authMode: "oauth",
        oauthConnected: true,
        spreadsheetId: "",
        listOnly: true,
        silent: true,
      });
    } catch (error) {
      const description = await extractFunctionInvokeErrorMessage(
        error,
        error instanceof Error ? error.message : "Não foi possivel conectar a conta Google.",
      );

      toast({
        title: "Erro ao conectar com Google",
        description,
        variant: "destructive",
      });
    } finally {
      setConnectingGoogleOauth(false);
    }
  }, [activeLaunch, gsSpreadsheetId, loadGoogleSheetsCatalog, toast]);

  const disconnectGoogleSheetsOauth = useCallback(async () => {
    if (!activeLaunch) return;

    setDisconnectingGoogleOauth(true);

    try {
      const { data, error } = await supabase.functions.invoke("google-oauth-disconnect", {
        body: {
          launchId: activeLaunch.id,
        },
      });

      const launch = (data as { launch?: LaunchSettingsRow } | null)?.launch ?? null;
      if (error || !launch) {
        throw error ?? new Error("Não foi possivel desconectar a conta Google.");
      }

      setLaunchSettings(launch);
      setHydratedLaunchId(activeLaunch.id);
      setGsEnabled(false);
      setGsOauthEmail("");
      setGsOauthConnected(false);
      setGsSpreadsheetId("");
      setGsSpreadsheetTitle("");
      setGsSheetName("");
      setGsAvailableSpreadsheets([]);
      setGsAvailableSheets([]);

      toast({
        title: "Conta Google desconectada",
        description: "A integração do Google Sheets foi desligada para este expert.",
      });
    } catch (error) {
      const description = await extractFunctionInvokeErrorMessage(
        error,
        "Não foi possivel desconectar a conta Google.",
      );

      toast({
        title: "Erro ao desconectar Google",
        description,
        variant: "destructive",
      });
    } finally {
      setDisconnectingGoogleOauth(false);
    }
  }, [activeLaunch, toast]);

  const syncActiveCampaignAfterSave = useCallback(
    async (launchId: string) => {
      if (!acApiUrl.trim() || !acApiKey.trim()) {
        setActiveCampaignSyncRun(null);
        setActiveCampaignSyncMessage(null);
        return;
      }

      setSyncingActiveCampaign(true);
      setActiveCampaignSyncMessage("Sincronizando contatos no backend. Nenhum contato sera exibido na tela.");

      try {
        const { data, error } = await supabase.functions.invoke("sync-platform-contacts", {
          body: {
            launchId,
            source: "activecampaign",
            syncMode: "full",
            trigger: "save_activecampaign",
          },
        });

        const typedData = (data as SyncPlatformContactsResponse | null) ?? null;

        if (error || !typedData) {
          throw new Error(error?.message || "O backend não conseguiu iniciar a sincronização.");
        }

        const latestRun =
          (await loadLatestActiveCampaignSyncRun(launchId, { silent: true })) ?? null;
        const latestCounters = parseAggregateSyncCounters(latestRun);
        const latestCursor = parseActiveCampaignSyncCursor(latestRun?.metadata ?? typedData.metadata);

        setActiveCampaignSyncMessage(
          latestCursor.hasMore
            ? `Sincronizando contatos no backend... ${latestCounters.processedCount} contato(s) tratados até agora. A fila continuara automaticamente mesmo se você fechar a aba.`
            : `Base sincronizada: ${latestCounters.processedCount} contato(s) tratados no backend.`,
        );

        if (latestCursor.hasMore) {
          toast({
            title: "Sincronização iniciada",
            description:
              "Os próximos lotes continuarao automaticamente no backend, mesmo se você trocar de tela ou fechar a aba.",
          });
          return;
        }

        toast({
          title: "Base do ActiveCampaign sincronizada",
          description: `${latestCounters.processedCount} contato(s) tratados no backend para este expert.`,
        });
      } catch (error) {
        const description = await extractFunctionInvokeErrorMessage(
          error,
          "Não foi possivel concluir a sincronização.",
        );

        await markLatestActiveCampaignSyncRunAsFailed(launchId, description, { silent: true });

        setActiveCampaignSyncMessage(null);
        toast({
          title: "Erro ao sincronizar a base do ActiveCampaign",
          description,
          variant: "destructive",
        });
      } finally {
        setSyncingActiveCampaign(false);
        await loadLatestActiveCampaignSyncRun(launchId, { silent: true });
      }
    },
    [
      acApiKey,
      acApiUrl,
      loadLatestActiveCampaignSyncRun,
      markLatestActiveCampaignSyncRunAsFailed,
      toast,
    ],
  );

  const saveActiveCampaign = async () => {
    if (!activeLaunch) return;

    setSaving("active");
    const { error, data } = await supabase
      .rpc("update_launch_activecampaign_settings", {
        target_launch_id: activeLaunch.id,
        next_api_url: acApiUrl || null,
        next_api_key: acApiKey || null,
        next_default_list_id: acListId || null,
        next_named_tags: acNamedTags as unknown as Json,
      });

    setSaving(null);

    if (error || !data) {
      toast({
        title: "Erro ao salvar ActiveCampaign",
        description: error?.message || "O backend não confirmou a atualização.",
        variant: "destructive",
      });
      return;
    }

    setLaunchSettings(data as unknown as LaunchSettingsRow);
    setHydratedLaunchId(activeLaunch.id);
    setTagBindingsDirty(false);
    void loadActiveCampaignCatalog({
      apiUrl: acApiUrl,
      apiKey: acApiKey,
      launchId: activeLaunch.id,
      silent: true,
    });
    toast({
      title: "ActiveCampaign salvo",
      description: activeConnected
        ? "As credenciais e o roteamento por tags foram atualizados para este expert."
        : "As credenciais de saida para o ActiveCampaign foram atualizadas.",
    });
    setActiveCampaignSyncRun(null);
    setActiveCampaignSyncMessage(null);
  };

  const saveGoogleSheets = async () => {
    if (!activeLaunch) return;

    const selectedAuthMode = gsAuthMode;
    const selectedSpreadsheetId = gsSpreadsheetId.trim();
    const selectedSpreadsheetTitle = gsSpreadsheetTitle.trim();
    const selectedSheetName =
      gsSheetName.trim() ||
      gsAvailableSheets.find((sheet) => typeof sheet.title === "string" && sheet.title.trim())
        ?.title?.trim() ||
      "";
    const selectedCaptureTagId = gsCaptureTagId.trim();
    const selectedCaptureTagName =
      gsCaptureTagName.trim() ||
      activeCampaignTags.find((tag) => tag.id === selectedCaptureTagId)?.name?.trim() ||
      "";
    const selectedDefaultProductName = gsDefaultProductName.trim();
    const selectedServiceAccountEmail = gsServiceAccountEmail.trim();
    const selectedPrivateKey = gsPrivateKey.trim();

    if (gsEnabled) {
      if (selectedAuthMode === "oauth" && (!gsOauthConnected || !selectedSpreadsheetId || !selectedSheetName)) {
        toast({
          title: "Finalize a conexão do Google Sheets",
          description:
            "Conecte sua conta Google e escolha a planilha e a aba antes de ativar a captura.",
          variant: "destructive",
        });
        return;
      }

      if (
        selectedAuthMode === "service_account" &&
        (!selectedServiceAccountEmail ||
          !selectedPrivateKey ||
          !selectedSpreadsheetId ||
          !selectedSheetName)
      ) {
        toast({
          title: "Preencha a conexão do Google Sheets",
          description:
            "Ative o Google Sheets apenas depois de informar a service account, a chave privada, o ID da planilha e a aba de destino.",
          variant: "destructive",
        });
        return;
      }
    }

    setSaving("gsheets");
    const { error, data } = await supabase.rpc("update_launch_google_sheets_settings", {
      target_launch_id: activeLaunch.id,
      next_auth_mode: selectedAuthMode,
      next_enabled: gsEnabled,
      next_service_account_email: selectedAuthMode === "service_account" ? selectedServiceAccountEmail || null : null,
      next_private_key: selectedAuthMode === "service_account" ? selectedPrivateKey || null : null,
      next_spreadsheet_id: selectedSpreadsheetId || null,
      next_spreadsheet_title: selectedSpreadsheetTitle || null,
      next_sheet_name: selectedSheetName || null,
      next_capture_tag_id: selectedCaptureTagId || null,
      next_capture_tag_name: selectedCaptureTagName || null,
      next_default_product_name: selectedDefaultProductName || null,
    } as never);

    setSaving(null);

    if (error || !data) {
      toast({
        title: "Erro ao salvar Google Sheets",
        description: error?.message || "O backend não confirmou a atualização da planilha.",
        variant: "destructive",
      });
      return;
    }

    setLaunchSettings(data as unknown as LaunchSettingsRow);
    setHydratedLaunchId(activeLaunch.id);
    setGsSheetName(selectedSheetName);
    setGsCaptureTagId(selectedCaptureTagId);
    setGsCaptureTagName(selectedCaptureTagName);
    setGsDefaultProductName(selectedDefaultProductName);
    if (
      gsEnabled &&
      ((selectedAuthMode === "oauth" && gsOauthConnected && selectedSpreadsheetId) ||
        (selectedAuthMode === "service_account" &&
          selectedServiceAccountEmail &&
          selectedPrivateKey &&
          selectedSpreadsheetId))
    ) {
      void loadGoogleSheetsCatalog({
        launchId: activeLaunch.id,
        authMode: selectedAuthMode,
        ...(selectedAuthMode === "service_account"
          ? {
              serviceAccountEmail: selectedServiceAccountEmail,
              privateKey: selectedPrivateKey,
            }
          : {}),
        spreadsheetId: selectedSpreadsheetId,
        silent: true,
      });
    }
    toast({
      title: "Google Sheets salvo",
      description: gsEnabled
        ? "Os webhooks do ActiveCampaign agora podem ser espelhados para a planilha escolhida."
        : "A captura complementar no Google Sheets foi desativada para este expert.",
    });
  };

  const saveUchat = async () => {
    if (!activeLaunch) return;

    setSaving("uchat");

    const rows = uchatWorkspaces
      .filter((workspace) => workspace.workspace_id.trim() && workspace.api_token.trim())
      .map((workspace) => ({
        workspace_name: workspace.workspace_name || "Workspace UChat",
        workspace_id: workspace.workspace_id || null,
        bot_id: workspace.workspace_id || null,
        api_token: workspace.api_token,
        welcome_subflow_ns: workspace.welcome_subflow_ns || null,
        default_tag_name: workspace.default_tag_name || null,
      }));

    const { error, data } = await supabase.rpc("replace_launch_uchat_workspaces", {
      target_launch_id: activeLaunch.id,
      next_workspaces: rows as unknown as Json,
    });

    if (error) {
      setSaving(null);
      toast({
        title: "Erro ao salvar UChat",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const savedWorkspaces = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    setUchatWorkspaces(
      savedWorkspaces.map((workspace) => ({
        id: typeof workspace.id === "string" ? workspace.id : undefined,
        workspace_name: typeof workspace.workspace_name === "string" ? workspace.workspace_name : "",
        workspace_id: typeof workspace.workspace_id === "string" ? workspace.workspace_id : "",
        api_token: typeof workspace.api_token === "string" ? workspace.api_token : "",
        welcome_subflow_ns:
          typeof workspace.welcome_subflow_ns === "string" ? workspace.welcome_subflow_ns : "",
        default_tag_name:
          typeof workspace.default_tag_name === "string" ? workspace.default_tag_name : "",
      })),
    );

    setSaving(null);
    setHydratedLaunchId(activeLaunch.id);
    toast({
      title: "UChat salvo",
      description: "Os workspaces e as ações de retorno do UChat foram atualizados.",
    });
  };

  const copyText = async (value: string, label: string) => {
    if (!value) {
      toast({
        title: "Nada para copiar",
        description: `O ${label.toLowerCase()} ainda não esta disponível.`,
        variant: "destructive",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copiado`, description: "Cole isso na plataforma de origem." });
    } catch (error) {
      toast({
        title: "Falha ao copiar",
        description:
          error instanceof Error ? error.message : "Não foi possivel copiar agora.",
        variant: "destructive",
      });
    }
  };

  if (!activeLaunch) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Radio className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Fontes</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Selecione um expert</CardTitle>
            <CardDescription>
              Escolha um expert na barra lateral para configurar webhooks e as saidas para
              ActiveCampaign, UChat e Google Sheets.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const bulkProgressPercent =
    bulkUpdateProgress && bulkUpdateProgress.totalRows > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((bulkUpdateProgress.processedRows / bulkUpdateProgress.totalRows) * 100)),
        )
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Radio className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Fontes</h1>
            <p className="text-sm text-muted-foreground">
              O Launch Hub recebe sinais por webhook e usa ActiveCampaign, UChat e Google Sheets
              como saidas do expert{" "}
              <span className="font-medium text-foreground">{activeLaunch.name}</span>.
            </p>
          </div>
        </div>
        <Badge variant="outline">
          {visibleLaunchSettings?.slug || activeLaunch.slug || "sem-slug"}
        </Badge>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-6">
          <Webhook className="mt-0.5 h-5 w-5 text-primary" />
          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Modelo webhook-first por expert</p>
            <p>
              Entradas: ActiveCampaign, UChat, ManyChat, Typebot, Tally e Sendflow.
            </p>
            <p>Saidas: ActiveCampaign, UChat e espelhamento opcional no Google Sheets.</p>
          </div>
        </CardContent>
      </Card>

      {showInitialSourcesLoader ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-xl">ActiveCampaign</CardTitle>
                <CardDescription>
                  Credenciais de saida para devolver contatos tratados, aplicar tags/lista e validar as tags usadas pelo roteamento dos webhooks.
                </CardDescription>
              </div>
              <ConnectionBadge connected={activeConnected} />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ac-url">API URL</Label>
                <Input
                  id="ac-url"
                  value={visibleAcApiUrl}
                  onChange={(event) => setAcApiUrl(event.target.value)}
                  placeholder="https://sua-conta.api-us1.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ac-key">API Key</Label>
                <Input
                  id="ac-key"
                  type="password"
                  value={visibleAcApiKey}
                  onChange={(event) => setAcApiKey(event.target.value)}
                  placeholder="Cole a chave da API"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ac-list-id">Lista padrão</Label>
                <Input
                  id="ac-list-id"
                  value={visibleAcListId}
                  onChange={(event) => setAcListId(event.target.value)}
                  placeholder="Ex: 1"
                />
              </div>
              <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">Ciclo operacional</p>
                    <p className="text-sm text-muted-foreground">
                      O ActiveCampaign não sincroniza mais a base inteira. Este expert trabalha apenas com contatos que entrarem pelos webhooks.
                    </p>
                  </div>
                  <Badge variant="secondary">Webhook-only</Badge>
                </div>

                <div className="rounded-xl border border-border/60 bg-background/50 p-4">
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      Ciclo atual:{" "}
                      <span className="font-medium text-foreground">
                        #{visibleLaunchSettings?.current_cycle_number ?? activeLaunch.current_cycle_number}
                      </span>
                    </p>
                    <p>
                      Inicio do ciclo:{" "}
                      <span className="font-medium text-foreground">
                        {visibleLaunchSettings?.current_cycle_started_at
                          ? new Date(visibleLaunchSettings.current_cycle_started_at).toLocaleString("pt-BR")
                          : "-"}
                      </span>
                    </p>
                    <p>
                      Quando você usar <span className="font-medium text-foreground">Mudar ciclo</span> em Experts,
                      os leads atuais serao arquivados em CSV e o próximo webhook abrira uma nova base canônica.
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Tags nomeadas</Label>
                <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">Tags sincronizadas do ActiveCampaign</p>
                      <p className="text-sm text-muted-foreground">
                        Carregue as tags reais da conta e escolha quais devem ser aplicadas quando o
                        webhook vier do Typebot, do ManyChat, do Tally ou do Sendflow.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void loadActiveCampaignCatalog()}
                      disabled={saving !== null || loadingActiveCampaignTags || !activeConnected}
                    >
                      {loadingActiveCampaignTags && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Carregar tags do ActiveCampaign
                    </Button>
                  </div>

                  {visibleActiveCampaignTagsLoadedAt && (
                    <p className="text-xs text-muted-foreground">
                      {visibleActiveCampaignTags.length} tag(s) carregada(s) em{" "}
                      {new Date(visibleActiveCampaignTagsLoadedAt).toLocaleString("pt-BR")}.
                    </p>
                  )}

                  {savingTagBindings && (
                    <p className="text-xs text-muted-foreground">
                      Salvando selecao de tags para os webhooks...
                    </p>
                  )}

                  <ActiveCampaignSourceTagBindings
                    availableTags={visibleActiveCampaignTags}
                    bindings={managedSourceBindings}
                    disabled={saving !== null || loadingActiveCampaignTags}
                    onToggleTag={updateManagedSourceTags}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Mapeamentos avancados</p>
                  <p className="text-sm text-muted-foreground">
                    Use esta area para aliases extras, estados personalizados ou qualquer regra que
                    não seja o roteamento padrão de Typebot, ManyChat, Tally e Sendflow.
                  </p>
                  <NamedTagsEditor
                    tags={advancedNamedTags}
                    onChange={updateAdvancedNamedTags}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => void saveActiveCampaign()} disabled={saving !== null}>
                {saving === "active" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar ActiveCampaign
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-xl">Google Sheets</CardTitle>
                <CardDescription>
                  Espelhamento opcional dos contatos que entrarem pelo webhook do ActiveCampaign para uma planilha do Google.
                </CardDescription>
              </div>
              <ConnectionBadge connected={googleSheetsConnected} />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/40 p-4">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Ativar captura em planilha</p>
                  <p className="text-sm text-muted-foreground">
                    Quando ligado, cada webhook do ActiveCampaign também grava nome, email, telefone, tags e payload na planilha escolhida.
                  </p>
                </div>
                <Switch checked={visibleGsEnabled} onCheckedChange={setGsEnabled} />
              </div>

              <div className="space-y-2">
                <Label>Modo de conexão</Label>
                <Select
                  value={visibleGsAuthMode}
                  onValueChange={(value) =>
                    setGsAuthMode(normalizeGoogleSheetsAuthMode(value))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Escolher modo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oauth">Login com Google</SelectItem>
                    <SelectItem value="service_account">Service account avancada</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {visibleGsAuthMode === "oauth" ? (
                <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">Conta Google conectada</p>
                      <p className="text-sm text-muted-foreground">
                        Entre com a conta Google do expert para listar todas as planilhas disponíveis e escolher a aba de destino.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void connectGoogleSheetsOauth()}
                        disabled={saving !== null || connectingGoogleOauth}
                      >
                        {connectingGoogleOauth && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {visibleGsOauthConnected ? "Reconectar Google" : "Conectar com Google"}
                      </Button>
                      {visibleGsOauthConnected && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void disconnectGoogleSheetsOauth()}
                          disabled={saving !== null || disconnectingGoogleOauth}
                        >
                          {disconnectingGoogleOauth && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Desconectar
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-background/50 p-4 text-sm text-muted-foreground">
                    {visibleGsOauthConnected ? (
                      <p>
                        Conta ativa:{" "}
                        <span className="font-medium text-foreground">
                          {visibleGsOauthEmail || "Google conectado"}
                        </span>
                      </p>
                    ) : (
                      <p>Nenhuma conta Google conectada ainda para este expert.</p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="gs-email">Service account email</Label>
                    <Input
                      id="gs-email"
                      value={visibleGsServiceAccountEmail}
                      onChange={(event) => setGsServiceAccountEmail(event.target.value)}
                      placeholder="service-account@projeto.iam.gserviceaccount.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gs-key">Chave privada</Label>
                    <Textarea
                      id="gs-key"
                      value={visibleGsPrivateKey}
                      onChange={(event) => setGsPrivateKey(event.target.value)}
                      placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
                      className="min-h-[160px] font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Compartilhe a planilha com esse email da service account antes de carregar as abas.
                    </p>
                  </div>
                </>
              )}

              <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      {visibleGsAuthMode === "oauth" ? "Planilhas e abas" : "Abas disponíveis"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {visibleGsAuthMode === "oauth"
                        ? "Carregue a conta Google conectada, escolha uma planilha e depois a aba onde os contatos serao salvos."
                        : "Carregue a planilha para escolher a aba onde os contatos do webhook do ActiveCampaign serao salvos."}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void loadGoogleSheetsCatalog({
                        authMode: visibleGsAuthMode,
                        ...(visibleGsAuthMode === "oauth"
                          ? {
                              spreadsheetId: visibleGsSpreadsheetId.trim(),
                              listOnly: !visibleGsSpreadsheetId.trim(),
                            }
                          : {}),
                      })
                    }
                    disabled={saving !== null || loadingGoogleSheetsCatalog}
                  >
                    {loadingGoogleSheetsCatalog && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {visibleGsAuthMode === "oauth" ? "Carregar planilhas" : "Carregar abas"}
                  </Button>
                </div>

                {visibleGsSpreadsheetTitle && (
                  <p className="text-xs text-muted-foreground">
                    Planilha conectada: <span className="font-medium text-foreground">{visibleGsSpreadsheetTitle}</span>
                  </p>
                )}

                {visibleGsAuthMode === "oauth" && (
                  <div className="space-y-2">
                    <Label>Planilha de destino</Label>
                    <Select
                      value={visibleGsSpreadsheetId || undefined}
                      onValueChange={(value) => {
                        setGsSpreadsheetId(value);
                        const selectedSpreadsheet =
                          visibleGsAvailableSpreadsheets.find((spreadsheet) => spreadsheet.id === value) ?? null;
                        setGsSpreadsheetTitle(selectedSpreadsheet?.title ?? "");
                        setGsSheetName("");
                        setGsAvailableSheets([]);
                        void loadGoogleSheetsCatalog({
                          launchId: activeLaunchId,
                          authMode: "oauth",
                          oauthConnected: true,
                          spreadsheetId: value,
                          silent: false,
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Escolher planilha" />
                      </SelectTrigger>
                      <SelectContent>
                        {visibleGsAvailableSpreadsheets.map((spreadsheet) => (
                          <SelectItem key={spreadsheet.id} value={spreadsheet.id}>
                            {spreadsheet.title || spreadsheet.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {visibleGsAuthMode === "service_account" && (
                  <div className="space-y-2">
                    <Label htmlFor="gs-spreadsheet">Spreadsheet ID</Label>
                    <Input
                      id="gs-spreadsheet"
                      value={visibleGsSpreadsheetId}
                      onChange={(event) => setGsSpreadsheetId(event.target.value)}
                      placeholder="Cole o ID da planilha do Google"
                    />
                  </div>
                )}

                {visibleGsAuthMode === "oauth" ? (
                  <div className="space-y-2">
                    <Label>Aba de destino</Label>
                    <Select
                      value={visibleGsSheetName || undefined}
                      onValueChange={setGsSheetName}
                      disabled={!visibleGsSpreadsheetId.trim() && visibleGsAvailableSheets.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            loadingGoogleSheetsCatalog
                              ? "Carregando abas"
                              : visibleGsSpreadsheetId.trim() || visibleGsAvailableSheets.length > 0
                              ? "Escolher aba"
                              : "Escolha uma planilha primeiro"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {visibleGsAvailableSheets.map((sheet) => (
                          <SelectItem
                            key={`${sheet.id ?? "sheet"}-${sheet.title ?? "sem-titulo"}`}
                            value={sheet.title || `sheet-${sheet.id ?? 0}`}
                          >
                            {sheet.title || `Aba ${sheet.id ?? ""}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : gsAvailableSheets.length > 0 ? (
                  <div className="space-y-2">
                    <Label>Aba de destino</Label>
                    <Select value={visibleGsSheetName || undefined} onValueChange={setGsSheetName}>
                      <SelectTrigger>
                        <SelectValue placeholder="Escolher aba" />
                      </SelectTrigger>
                      <SelectContent>
                        {gsAvailableSheets.map((sheet) => (
                          <SelectItem key={`${sheet.id ?? "sheet"}-${sheet.title ?? "sem-título"}`} value={sheet.title || `sheet-${sheet.id ?? 0}`}>
                            {sheet.title || `Aba ${sheet.id ?? ""}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="gs-sheet">Aba de destino</Label>
                    <Input
                      id="gs-sheet"
                      value={visibleGsSheetName}
                      onChange={(event) => setGsSheetName(event.target.value)}
                      placeholder="Ex: Captura Active"
                    />
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-4">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Revisão horária da captura</p>
                  <p className="text-sm text-muted-foreground">
                    A cada 1 hora, o backend procura no ActiveCampaign quem tem a tag abaixo e ainda não está na planilha,
                    então envia a linha usando o mesmo mapeamento dos webhooks do ActiveCampaign.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Tag do evento no ActiveCampaign</Label>
                  <Select
                    value={visibleGsCaptureTagId || NO_CAPTURE_TAG_VALUE}
                    onValueChange={(value) => {
                      if (value === NO_CAPTURE_TAG_VALUE) {
                        setGsCaptureTagId("");
                        setGsCaptureTagName("");
                        return;
                      }

                      const selectedTag = visibleActiveCampaignTags.find((tag) => tag.id === value);
                      setGsCaptureTagId(value);
                      setGsCaptureTagName(selectedTag?.name ?? "");
                    }}
                    disabled={saving !== null || loadingActiveCampaignTags || visibleActiveCampaignTags.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          loadingActiveCampaignTags
                            ? "Carregando tags"
                            : visibleActiveCampaignTags.length > 0
                              ? "Escolher tag do evento"
                              : "Carregue as tags do ActiveCampaign primeiro"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CAPTURE_TAG_VALUE}>Sem revisão horária</SelectItem>
                      {visibleGsCaptureTagId &&
                        !visibleActiveCampaignTags.some((tag) => tag.id === visibleGsCaptureTagId) && (
                          <SelectItem value={visibleGsCaptureTagId}>
                            {visibleGsCaptureTagName || `Tag #${visibleGsCaptureTagId}`} #{visibleGsCaptureTagId}
                          </SelectItem>
                        )}
                      {visibleActiveCampaignTags.map((tag) => (
                        <SelectItem key={`capture-${tag.id}`} value={tag.id}>
                          {tag.name} #{tag.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {visibleGsCaptureTagName && (
                    <p className="text-xs text-muted-foreground">
                      Tag monitorada: <span className="font-medium text-foreground">{visibleGsCaptureTagName}</span>
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gs-default-product">Produto padrão quando vier vazio</Label>
                  <Input
                    id="gs-default-product"
                    value={visibleGsDefaultProductName}
                    onChange={(event) => setGsDefaultProductName(event.target.value)}
                    placeholder="Ex: Libras Sem Medo"
                  />
                  <p className="text-xs text-muted-foreground">
                    Se o campo Produto vier preenchido do ActiveCampaign, o valor original é preservado.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">Atualização por CSV</p>
                    <p className="text-sm text-muted-foreground">
                      Use CSV comum para atualizar valores fixos na captura, ou CSV exportado do ActiveCampaign para comparar bases e inserir apenas quem ainda não está na planilha.
                    </p>
                  </div>
                  <Badge variant="secondary">Deduplica por email e telefone</Badge>
                </div>

                <div className="space-y-2">
                  <Label>Tipo de operação</Label>
                  <Select value={bulkCsvMode} onValueChange={(value) => setBulkCsvMode(value as BulkCsvMode)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Escolher tipo de CSV" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed_update">Atualizar valores fixos por email</SelectItem>
                      <SelectItem value="active_export_import">Importar CSV exportado do ActiveCampaign</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {bulkCsvMode === "active_export_import"
                      ? "Neste modo, quem já existe na captura é ignorado. Quem não existe é inserido usando os dados do próprio CSV."
                      : "Neste modo, o CSV só localiza emails existentes; os valores digitados abaixo atualizam as colunas escolhidas."}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <div className="space-y-2">
                    <Label htmlFor="gs-bulk-csv">Arquivo CSV</Label>
                    <Input
                      id="gs-bulk-csv"
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) => void handleBulkCsvFileChange(event)}
                      disabled={!googleSheetsConnected || bulkUpdatingGoogleSheets}
                    />
                    <p className="text-xs text-muted-foreground">
                      O arquivo precisa ter uma coluna de email. Se vier telefone no CSV, ele também será usado para evitar duplicidade na captura.
                    </p>
                  </div>
                  {bulkCsvMode === "fixed_update" && (
                    <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addBulkColumnMapping}
                      disabled={bulkCsvHeaders.length === 0 || bulkUpdatingGoogleSheets}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Adicionar valor
                    </Button>
                    </div>
                  )}
                </div>

                {bulkCsvFileName && (
                  <div className="rounded-xl border border-border/60 bg-background/50 p-4 text-sm text-muted-foreground">
                    <p>
                      CSV carregado:{" "}
                      <span className="font-medium text-foreground">{bulkCsvFileName}</span>
                    </p>
                    <p>
                      {bulkCsvRows.length} linha(s), {bulkCsvHeaders.length} coluna(s).
                    </p>
                  </div>
                )}

                {bulkCsvHeaders.length > 0 && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Coluna de email para procurar na captura</Label>
                      <Select value={bulkEmailColumn || undefined} onValueChange={setBulkEmailColumn}>
                        <SelectTrigger>
                          <SelectValue placeholder="Escolher coluna de email do CSV" />
                        </SelectTrigger>
                        <SelectContent>
                          {bulkCsvHeaders.map((header) => (
                            <SelectItem key={`bulk-email-${header}`} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {bulkCsvMode === "fixed_update" && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label>Valores para aplicar</Label>
                        <span className="text-xs text-muted-foreground">
                          Valor fixo → Coluna da captura
                        </span>
                      </div>

                      {bulkColumnMappings.map((mapping, index) => (
                        <div key={`bulk-mapping-${index}`} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                          <Input
                            value={mapping.value}
                            onChange={(event) => updateBulkColumnMapping(index, "value", event.target.value)}
                            placeholder="Ex: ORG-API"
                            disabled={bulkUpdatingGoogleSheets}
                          />

                          <Select
                            value={mapping.sheetColumn || undefined}
                            onValueChange={(value) => updateBulkColumnMapping(index, "sheetColumn", value)}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Coluna da captura" />
                            </SelectTrigger>
                            <SelectContent>
                              {CAPTURE_SHEET_COLUMNS.map((column) => (
                                <SelectItem key={`bulk-sheet-${index}-${column}`} value={column}>
                                  {column}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => removeBulkColumnMapping(index)}
                            disabled={bulkColumnMappings.length <= 1 || bulkUpdatingGoogleSheets}
                            aria-label="Remover mapeamento"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {bulkCsvMode === "active_export_import"
                          ? "O CSV exportado do ActiveCampaign é comparado com a captura. Existentes são ignorados; ausentes são inseridos com os dados do arquivo."
                          : "A atualização é feita por email. Os valores fixos acima atualizam a captura; ausentes só são inseridos se o ActiveCampaign confirmar a tag de captura configurada."}
                      </p>
                      <Button
                        type="button"
                        onClick={() => void runGoogleSheetsBulkUpdate()}
                        disabled={
                          bulkUpdatingGoogleSheets ||
                          saving !== null ||
                          !bulkEmailColumn ||
                          bulkCsvRows.length === 0 ||
                          (bulkCsvMode === "fixed_update" && bulkColumnMappings.length === 0)
                        }
                      >
                        {bulkUpdatingGoogleSheets ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="mr-2 h-4 w-4" />
                        )}
                        {bulkUpdatingGoogleSheets && bulkProgressPercent !== null
                          ? `${bulkProgressPercent}% processado`
                          : bulkCsvMode === "active_export_import"
                            ? "Importar ausentes"
                            : "Atualizar captura"}
                      </Button>
                    </div>
                    {bulkUpdateProgress && (
                      <p className="text-xs text-muted-foreground">
                        Processados {bulkUpdateProgress.processedRows} de {bulkUpdateProgress.totalRows} linha(s)
                        {bulkUpdateProgress.totalBatches > 0
                          ? ` · lote ${bulkUpdateProgress.currentBatch}/${bulkUpdateProgress.totalBatches}`
                          : ""}
                        {bulkProgressPercent !== null ? ` · ${bulkProgressPercent}%` : ""}
                      </p>
                    )}
                  </div>
                )}

                {bulkUpdateResult && (
                  <div className="rounded-xl border border-border/60 bg-background/50 p-4 space-y-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-medium text-foreground">Resultado da atualização</p>
                      <Badge variant={bulkUpdateResult.summary.notFoundRows > 0 ? "secondary" : "default"}>
                        {bulkUpdateResult.summary.mode === "active_export_import"
                          ? `${bulkUpdateResult.summary.insertedFromCsv} linha(s) inserida(s)`
                          : `${bulkUpdateResult.summary.updatedRows} linha(s) atualizada(s)`}
                      </Badge>
                    </div>
                    <div className="grid gap-2 text-muted-foreground md:grid-cols-3">
                      <p>
                        Identidades únicas:{" "}
                        {bulkUpdateResult.summary.uniqueIdentities || bulkUpdateResult.summary.uniqueEmails}
                      </p>
                      <p>Linhas sem email/telefone útil: {bulkUpdateResult.summary.missingIdentityRows}</p>
                      {bulkUpdateResult.summary.mode === "active_export_import" ? (
                        <p>Inseridos pelo CSV: {bulkUpdateResult.summary.insertedFromCsv}</p>
                      ) : (
                        <p>Células atualizadas: {bulkUpdateResult.summary.updatedCells}</p>
                      )}
                      {bulkUpdateResult.summary.mode === "active_export_import" && (
                        <p>Linhas completadas: {bulkUpdateResult.summary.updatedRows}</p>
                      )}
                      <p>Já existiam na captura: {bulkUpdateResult.summary.matchedRows}</p>
                      {bulkUpdateResult.summary.mode === "fixed_update" && (
                        <p>Células já corretas: {bulkUpdateResult.summary.skippedUnchangedCells}</p>
                      )}
                      {bulkUpdateResult.summary.mode === "fixed_update" && (
                        <p>Inseridos via Active: {bulkUpdateResult.summary.insertedFromActive}</p>
                      )}
                      <p>Ausentes na planilha: {bulkUpdateResult.summary.missingFromSheetRows}</p>
                      <p>Encontrados por telefone: {bulkUpdateResult.summary.matchedByPhoneRows}</p>
                      {bulkUpdateResult.summary.mode === "fixed_update" && (
                        <p>Sem tag de captura: {bulkUpdateResult.summary.activeContactsWithoutCaptureTag}</p>
                      )}
                      <p>Alertas finais: {bulkUpdateResult.summary.notFoundRows}</p>
                    </div>
                    {bulkUpdateResult.notFound.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-foreground">E-mails não encontrados</p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              downloadCsv(
                                "launchhub-emails-nao-encontrados.csv",
                                bulkUpdateResult.notFound,
                              )
                            }
                          >
                            Baixar relatório
                          </Button>
                        </div>
                        <div className="max-h-32 overflow-auto rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
                          {bulkUpdateResult.notFound.slice(0, 20).map((item) => (
                            <p key={`bulk-not-found-${item.email}`}>
                              {item.email}
                              {item.name ? ` · ${item.name}` : ""}
                              {item.phone ? ` · ${item.phone}` : ""}
                              {item.reason ? ` · ${item.reason}` : ""}
                            </p>
                          ))}
                          {bulkUpdateResult.notFound.length > 20 && (
                            <p>+{bulkUpdateResult.notFound.length - 20} outro(s) no relatório.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => void saveGoogleSheets()} disabled={saving !== null || loadingGoogleSheetsCatalog}>
                {saving === "gsheets" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar Google Sheets
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-xl">UChat</CardTitle>
                <CardDescription>
                  Workspaces de destino para o retorno Launch Hub {"->"} UChat, com subflow de boas-vindas e/ou add tag.
                  Eventos vindos do proprio UChat sao tratados no hub e nao retornam automaticamente ao subflow padrao.
                </CardDescription>
              </div>
              <ConnectionBadge connected={uchatConnected} />
            </CardHeader>
            <CardContent className="space-y-4">
              <UChatWorkspacesEditor
                workspaces={visibleUchatWorkspaces}
                onChange={setUchatWorkspaces}
              />
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => void saveUchat()} disabled={saving !== null}>
                {saving === "uchat" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar UChat
              </Button>
            </CardFooter>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-xl">Webhooks do expert</CardTitle>
              <CardDescription>
                Use estas URLs para ligar os sinais externos ao Launch Hub. Cada webhook já sai
                protegido pelo segredo do expert.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {inboundWebhookSources.map((source) => {
                const webhookUrl = visibleLaunchSettings
                  ? buildLaunchWebhookUrl(visibleLaunchSettings, source.key)
                  : "";

                return (
                  <div key={source.key} className="rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{source.label}</p>
                      <Badge variant="outline">{source.key}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{source.hint}</p>
                    <div className="mt-4 space-y-2">
                      <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => void copyText(webhookUrl, `Webhook ${source.label}`)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Copiar webhook
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

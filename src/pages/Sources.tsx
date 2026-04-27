import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Copy, Loader2, Radio, Webhook } from "lucide-react";
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
}

interface SourcesDraft {
  acApiUrl: string;
  acApiKey: string;
  acListId: string;
  acNamedTags: NamedTagDraft[];
  uchatWorkspaces: UChatWorkspaceDraft[];
  gsEnabled: boolean;
  gsAuthMode: GoogleSheetsAuthMode;
  gsServiceAccountEmail: string;
  gsPrivateKey: string;
  gsSpreadsheetId: string;
  gsSpreadsheetTitle: string;
  gsSheetName: string;
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
] as const;
const ACTIVECAMPAIGN_CATALOG_TIMEOUT_MS = 15000;
const ACTIVE_CAMPAIGN_STALE_SYNC_MS = 90_000;
const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_OAUTH_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined;
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
      gsServiceAccountEmail:
        typeof parsed.gsServiceAccountEmail === "string" ? parsed.gsServiceAccountEmail : "",
      gsPrivateKey: typeof parsed.gsPrivateKey === "string" ? parsed.gsPrivateKey : "",
      gsSpreadsheetId: typeof parsed.gsSpreadsheetId === "string" ? parsed.gsSpreadsheetId : "",
      gsSpreadsheetTitle:
        typeof parsed.gsSpreadsheetTitle === "string" ? parsed.gsSpreadsheetTitle : "",
      gsSheetName: typeof parsed.gsSheetName === "string" ? parsed.gsSheetName : "",
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

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"active" | "uchat" | "gsheets" | null>(null);
  const [hydratedLaunchId, setHydratedLaunchId] = useState<string | null>(null);

  const [launchSettings, setLaunchSettings] = useState<LaunchSettingsRow | null>(null);
  const [acApiUrl, setAcApiUrl] = useState("");
  const [acApiKey, setAcApiKey] = useState("");
  const [acListId, setAcListId] = useState("");
  const [acNamedTags, setAcNamedTags] = useState<NamedTagDraft[]>([]);
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
  const visibleActiveCampaignTags = isHydratedActiveLaunch ? activeCampaignTags : [];
  const visibleActiveCampaignTagsLoadedAt = isHydratedActiveLaunch
    ? activeCampaignTagsLoadedAt
    : null;
  const visibleActiveCampaignSyncRun = isHydratedActiveLaunch ? activeCampaignSyncRun : null;

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
      catalogRequestRef.current += 1;
      setLaunchSettings(null);
      setAcApiUrl("");
      setAcApiKey("");
      setAcListId("");
      setAcNamedTags([]);
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
      setHydratedLaunchId(null);

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
      const draft = parseSourcesDraft(localStorage.getItem(buildSourcesDraftKey(launchId)));

      setLaunchSettings(typedLaunch);
      setAcApiUrl(draft?.acApiUrl ?? typedLaunch.ac_api_url ?? "");
      setAcApiKey(draft?.acApiKey ?? typedLaunch.ac_api_key ?? "");
      setAcListId(draft?.acListId ?? typedLaunch.ac_default_list_id ?? "");
      setAcNamedTags(
        draft?.acNamedTags ??
          (Array.isArray(typedLaunch.ac_named_tags)
            ? (typedLaunch.ac_named_tags as NamedTagDraft[])
            : []),
      );
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
        gsServiceAccountEmail,
        gsPrivateKey,
        gsSpreadsheetId,
        gsSpreadsheetTitle,
        gsSheetName,
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
    gsServiceAccountEmail,
    gsPrivateKey,
    gsSpreadsheetId,
    gsSpreadsheetTitle,
    gsSheetName,
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
  };

  const updateAdvancedNamedTags = (nextAdvancedTags: NamedTagDraft[]) => {
    setAcNamedTags((currentTags) => {
      const managedTags = currentTags.filter((tag) =>
        managedAliasKeys.includes(normalizeKey(tag.alias)),
      );
      return [...managedTags, ...nextAdvancedTags];
    });
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
        setGsAvailableSpreadsheets(typedData.spreadsheets ?? []);
        if (listOnly) {
          const availableSpreadsheetIds = new Set(
            (typedData.spreadsheets ?? []).map((spreadsheet) => spreadsheet.id),
          );
          if (gsSpreadsheetId.trim() && !availableSpreadsheetIds.has(gsSpreadsheetId.trim())) {
            setGsSpreadsheetId("");
            setGsSpreadsheetTitle("");
            setGsSheetName("");
            setGsAvailableSheets([]);
          }
        }
        if (!listOnly) {
          setGsSpreadsheetTitle((currentTitle) =>
            typedData.selectedSpreadsheetTitle ?? currentTitle,
          );
          setGsSpreadsheetId((currentSpreadsheetId) =>
            typedData.selectedSpreadsheetId ?? currentSpreadsheetId,
          );
        }
        setGsAvailableSheets(
          typedData.sheets.map((sheet) => ({
            id: sheet.id,
            title: sheet.title,
          })),
        );

        if (!listOnly) {
          const firstSheetName =
            typedData.sheets.find((sheet) => typeof sheet.title === "string" && sheet.title.trim())
              ?.title ?? "";

          setGsSheetName((currentSheetName) =>
            currentSheetName.trim() ? currentSheetName : firstSheetName,
          );
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
  }, [activeLaunchId, hydratedLaunchId, visibleGsAuthMode, visibleGsOauthConnected]);

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

    if (gsEnabled) {
      if (gsAuthMode === "oauth" && (!gsOauthConnected || !gsSpreadsheetId.trim() || !gsSheetName.trim())) {
        toast({
          title: "Finalize a conexão do Google Sheets",
          description:
            "Conecte sua conta Google e escolha a planilha e a aba antes de ativar a captura.",
          variant: "destructive",
        });
        return;
      }

      if (
        gsAuthMode === "service_account" &&
        (!gsServiceAccountEmail.trim() ||
          !gsPrivateKey.trim() ||
          !gsSpreadsheetId.trim() ||
          !gsSheetName.trim())
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
      next_auth_mode: gsAuthMode,
      next_enabled: gsEnabled,
      next_service_account_email: gsAuthMode === "service_account" ? gsServiceAccountEmail || null : null,
      next_private_key: gsAuthMode === "service_account" ? gsPrivateKey || null : null,
      next_spreadsheet_id: gsSpreadsheetId || null,
      next_spreadsheet_title: gsSpreadsheetTitle || null,
      next_sheet_name: gsSheetName || null,
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
    if (
      gsEnabled &&
      ((gsAuthMode === "oauth" && gsOauthConnected && gsSpreadsheetId.trim()) ||
        (gsAuthMode === "service_account" &&
          gsServiceAccountEmail.trim() &&
          gsPrivateKey.trim() &&
          gsSpreadsheetId.trim()))
    ) {
      void loadGoogleSheetsCatalog({
        launchId: activeLaunch.id,
        authMode: gsAuthMode,
        ...(gsAuthMode === "service_account"
          ? {
              serviceAccountEmail: gsServiceAccountEmail,
              privateKey: gsPrivateKey,
            }
          : {}),
        spreadsheetId: gsSpreadsheetId,
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

      {loading ? (
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
                          ? { spreadsheetId: "", listOnly: true }
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
                          gsAvailableSpreadsheets.find((spreadsheet) => spreadsheet.id === value) ?? null;
                        setGsSpreadsheetTitle(selectedSpreadsheet?.title ?? "");
                        setGsSheetName("");
                        setGsAvailableSheets([]);
                        void loadGoogleSheetsCatalog({
                          authMode: "oauth",
                          spreadsheetId: value,
                          silent: true,
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Escolher planilha" />
                      </SelectTrigger>
                      <SelectContent>
                        {gsAvailableSpreadsheets.map((spreadsheet) => (
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

                {gsAvailableSheets.length > 0 ? (
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
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => void saveGoogleSheets()} disabled={saving !== null}>
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

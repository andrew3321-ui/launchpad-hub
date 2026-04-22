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
}

interface SourcesDraft {
  acApiUrl: string;
  acApiKey: string;
  acListId: string;
  acNamedTags: NamedTagDraft[];
  uchatWorkspaces: UChatWorkspaceDraft[];
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
    return fallback || "A continuacao automatica da sincronizacao foi interrompida antes do proximo lote.";
  }
  return fallback || "A sincronizacao anterior foi interrompida antes da finalizacao.";
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
      {connected ? "Configurado" : "Nao configurado"}
    </Badge>
  );
}

export default function Sources() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();
  const latestLaunchIdRef = useRef<string | null>(null);
  const catalogRequestRef = useRef(0);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"active" | "uchat" | null>(null);
  const [hydratedLaunchId, setHydratedLaunchId] = useState<string | null>(null);

  const [launchSettings, setLaunchSettings] = useState<LaunchSettingsRow | null>(null);
  const [acApiUrl, setAcApiUrl] = useState("");
  const [acApiKey, setAcApiKey] = useState("");
  const [acListId, setAcListId] = useState("");
  const [acNamedTags, setAcNamedTags] = useState<NamedTagDraft[]>([]);
  const [uchatWorkspaces, setUchatWorkspaces] = useState<UChatWorkspaceDraft[]>([]);
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
              "Nao foi possivel consultar as tags da conta com essas credenciais.",
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
            description: `${typedData.tags.length} tag(s) do ActiveCampaign disponiveis para mapeamento.`,
          });
        }
      } catch (error) {
        const description = await extractFunctionInvokeErrorMessage(
          error,
          "Nao foi possivel consultar as tags da conta agora.",
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
            title: "Erro ao finalizar a sincronizacao interrompida",
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
            title: "Erro ao verificar a ultima sincronizacao",
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
            title: "Erro ao carregar o status da sincronizacao",
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
        ? `Sincronizando contatos no backend... ${activeCampaignSyncCounters.processedCount} contato(s) tratados ate agora. A fila continua mesmo se voce trocar de tela ou fechar a aba.`
        : "Sincronizacao em andamento no backend.";
    }

    return "A ultima sincronizacao da conta ja foi registrada no backend.";
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
            "Nao foi possivel carregar as configuracoes do lancamento.",
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
      setHydratedLaunchId(launchId);
      setLoading(false);
      void loadLatestActiveCampaignSyncRun(launchId, { silent: true });
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeLaunchId, loadLatestActiveCampaignSyncRun, toast]);

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
  ]);

  useEffect(() => {
    if (!activeLaunchId || !isHydratedActiveLaunch) return;

    const isRunning = activeCampaignSyncIsRunning;
    if (!isRunning) return;

    const intervalId = window.setInterval(() => {
      void loadLatestActiveCampaignSyncRun(activeLaunchId, { silent: true });
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [
    activeLaunchId,
    activeCampaignSyncIsRunning,
    isHydratedActiveLaunch,
    loadLatestActiveCampaignSyncRun,
  ]);
  const uchatConnected = useMemo(
    () =>
      visibleUchatWorkspaces.some(
        (workspace) => workspace.workspace_id.trim() && workspace.api_token.trim(),
      ),
    [visibleUchatWorkspaces],
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
          throw new Error(error?.message || "O backend nao conseguiu iniciar a sincronizacao.");
        }

        const latestRun =
          (await loadLatestActiveCampaignSyncRun(launchId, { silent: true })) ?? null;
        const latestCounters = parseAggregateSyncCounters(latestRun);
        const latestCursor = parseActiveCampaignSyncCursor(latestRun?.metadata ?? typedData.metadata);

        setActiveCampaignSyncMessage(
          latestCursor.hasMore
            ? `Sincronizando contatos no backend... ${latestCounters.processedCount} contato(s) tratados ate agora. A fila continuara automaticamente mesmo se voce fechar a aba.`
            : `Base sincronizada: ${latestCounters.processedCount} contato(s) tratados no backend.`,
        );

        if (latestCursor.hasMore) {
          toast({
            title: "Sincronizacao iniciada",
            description:
              "Os proximos lotes continuarao automaticamente no backend, mesmo se voce trocar de tela ou fechar a aba.",
          });
          return;
        }

        toast({
          title: "Base do ActiveCampaign sincronizada",
          description: `${latestCounters.processedCount} contato(s) tratados no backend para este lancamento.`,
        });
      } catch (error) {
        const description = await extractFunctionInvokeErrorMessage(
          error,
          "Nao foi possivel concluir a sincronizacao.",
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
        description: error?.message || "O backend nao confirmou a atualizacao.",
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
        ? "As credenciais foram atualizadas e a sincronizacao da base sera feita no backend."
        : "As credenciais de saida para o ActiveCampaign foram atualizadas.",
    });

    if (acApiUrl.trim() && acApiKey.trim()) {
      await syncActiveCampaignAfterSave(activeLaunch.id);
    } else {
      setActiveCampaignSyncRun(null);
      setActiveCampaignSyncMessage(null);
    }
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
      description: "Os workspaces e as acoes de retorno do UChat foram atualizados.",
    });
  };

  const copyText = async (value: string, label: string) => {
    if (!value) {
      toast({
        title: "Nada para copiar",
        description: `O ${label.toLowerCase()} ainda nao esta disponivel.`,
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
          error instanceof Error ? error.message : "Nao foi possivel copiar agora.",
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
            <CardTitle>Selecione um lancamento</CardTitle>
            <CardDescription>
              Escolha um lancamento na barra lateral para configurar webhooks e as saidas para
              ActiveCampaign e UChat.
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
              O Launch Hub agora recebe sinais por webhook e so usa ActiveCampaign e UChat
              para devolver os contatos tratados do lancamento{" "}
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
            <p className="font-medium text-foreground">Modelo webhook-first por lancamento</p>
            <p>
              Entradas: ActiveCampaign, UChat, ManyChat, Typebot, Tally e Sendflow.
            </p>
            <p>Saidas: ActiveCampaign e UChat, apos verificacao e tratamento da base canonica.</p>
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
                  Credenciais de saida para receber os contatos tratados, aplicar tags/lista e
                  sincronizar a base diretamente no backend apos cada salvamento.
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
                <Label htmlFor="ac-list-id">Lista padrao</Label>
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
                    <p className="font-medium text-foreground">Sincronizacao da base</p>
                    <p className="text-sm text-muted-foreground">
                      Ao salvar o ActiveCampaign, o Launch Hub sincroniza toda a base no backend
                      em lotes automaticos. Os contatos nao aparecem no front.
                    </p>
                  </div>
                  <Badge
                    variant={
                      activeCampaignSyncIsRunning
                        ? "default"
                        : activeCampaignSyncBadgeLabel === "Falhou"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {activeCampaignSyncBadgeLabel}
                  </Badge>
                </div>

                <div className="rounded-xl border border-border/60 bg-background/50 p-4">
                  <div className="flex items-start gap-3">
                    {activeCampaignSyncIsRunning && (
                      <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-primary" />
                    )}
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>
                        {activeCampaignSyncStatusMessage}
                      </p>

                      {visibleActiveCampaignSyncRun && (
                        <p>
                          {activeCampaignSyncCounters.processedCount} tratado(s),{" "}
                          {activeCampaignSyncCounters.createdCount} novo(s),{" "}
                          {activeCampaignSyncCounters.mergedCount} mesclado(s),{" "}
                          {activeCampaignSyncCounters.errorCount} erro(s).
                        </p>
                      )}

                      {visibleActiveCampaignSyncRun?.finished_at && (
                        <p>
                          Ultima finalizacao em{" "}
                          {new Date(visibleActiveCampaignSyncRun.finished_at).toLocaleString("pt-BR")}.
                        </p>
                      )}

                      {visibleActiveCampaignSyncRun && activeCampaignSyncCursor.syncedUntil && !activeCampaignSyncCursor.hasMore && (
                        <p>
                          Base atualizada ate{" "}
                          {new Date(activeCampaignSyncCursor.syncedUntil).toLocaleString("pt-BR")}.
                        </p>
                      )}

                      {activeCampaignSyncLastError && (
                        <p className="text-destructive">
                          Ultimo erro: {activeCampaignSyncLastError}
                        </p>
                      )}
                    </div>
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
                      disabled={saving !== null || syncingActiveCampaign || loadingActiveCampaignTags || !activeConnected}
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
                    nao seja o roteamento padrao de Typebot, ManyChat, Tally e Sendflow.
                  </p>
                  <NamedTagsEditor
                    tags={advancedNamedTags}
                    onChange={updateAdvancedNamedTags}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => void saveActiveCampaign()} disabled={saving !== null || syncingActiveCampaign}>
                {(saving === "active" || syncingActiveCampaign) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {syncingActiveCampaign ? "Sincronizando base..." : "Salvar ActiveCampaign"}
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-xl">UChat</CardTitle>
                <CardDescription>
                  Workspaces de destino para o retorno ActiveCampaign/Sendflow {"->"} Launch Hub {"->"} UChat,
                  com subflow de boas-vindas e/ou add tag. Eventos vindos do proprio UChat
                  consultam o ActiveCampaign para duplicidade, mas nao retornam ao subflow
                  padrao de boas-vindas.
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
              <CardTitle className="text-xl">Webhooks do lancamento</CardTitle>
              <CardDescription>
                Use estas URLs para ligar os sinais externos ao Launch Hub. Cada webhook ja sai
                protegido pelo segredo do lancamento.
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

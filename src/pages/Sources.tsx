import { useEffect, useMemo, useState } from "react";
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
import { NamedTagsEditor } from "@/components/launches/NamedTagsEditor";
import { SchemaSetupCard } from "@/components/SchemaSetupCard";
import { SupabaseConnectionCard } from "@/components/SupabaseConnectionCard";
import { UChatWorkspacesEditor } from "@/components/launches/UChatWorkspacesEditor";
import { useLaunch } from "@/contexts/LaunchContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSyncRun, STALE_SYNC_ERROR_MESSAGE } from "@/lib/syncRuns";
import { DownloadCloud, Loader2, Radio, ShieldCheck } from "lucide-react";

interface NamedTag {
  alias: string;
  tag: string;
}

interface UChatWorkspace {
  id?: string;
  workspace_name: string;
  workspace_id: string;
  bot_id: string;
  api_token: string;
  max_subscribers: number;
  current_count: number;
}

type SyncSource = "activecampaign" | "uchat";

interface SyncRunRow {
  id: string;
  source: SyncSource;
  status: "running" | "completed" | "failed";
  processed_count: number;
  created_count: number;
  merged_count: number;
  error_count: number;
  skipped_count: number;
  started_at: string;
  finished_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
}

interface SourcesDraft {
  acApiUrl: string;
  acApiKey: string;
  acListId: string;
  acNamedTags: NamedTag[];
  manychatApiUrl: string;
  manychatApiKey: string;
  manychatAccountId: string;
  uchatWorkspaces: UChatWorkspace[];
}

const emptyUChatWorkspace: UChatWorkspace = {
  workspace_name: "",
  workspace_id: "",
  bot_id: "",
  api_token: "",
  max_subscribers: 1000,
  current_count: 0,
};

const pendingSyncMaxAgeMs = 1000 * 60 * 30;

function pendingSyncStorageKey(launchId: string, source: SyncSource) {
  return `megafone-sync-pending:${launchId}:${source}`;
}

function sourcesDraftStorageKey(launchId: string) {
  return `megafone-sources-draft:${launchId}`;
}

function markPendingSync(launchId: string, source: SyncSource) {
  localStorage.setItem(pendingSyncStorageKey(launchId, source), JSON.stringify({ startedAt: Date.now() }));
}

function clearPendingSync(launchId: string, source: SyncSource) {
  localStorage.removeItem(pendingSyncStorageKey(launchId, source));
}

function hasPendingSync(launchId: string, source: SyncSource) {
  const rawValue = localStorage.getItem(pendingSyncStorageKey(launchId, source));
  if (!rawValue) return false;

  try {
    const parsed = JSON.parse(rawValue) as { startedAt?: number };
    if (!parsed.startedAt || Date.now() - parsed.startedAt > pendingSyncMaxAgeMs) {
      clearPendingSync(launchId, source);
      return false;
    }

    return true;
  } catch {
    clearPendingSync(launchId, source);
    return false;
  }
}

function loadSourcesDraft(launchId: string) {
  const rawValue = localStorage.getItem(sourcesDraftStorageKey(launchId));
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue) as SourcesDraft;
  } catch {
    localStorage.removeItem(sourcesDraftStorageKey(launchId));
    return null;
  }
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <Badge variant={connected ? "default" : "secondary"}>
      {connected ? "Configurado" : "Não configurado"}
    </Badge>
  );
}

function SyncRunBadge({ run }: { run: SyncRunRow | null }) {
  if (!run) {
    return <Badge variant="outline">Nenhuma importação ainda</Badge>;
  }

  const normalizedRun = normalizeSyncRun(run);

  if (normalizedRun.status === "failed") {
    return <Badge variant="destructive">Falhou</Badge>;
  }

  if (normalizedRun.status === "running") {
    return <Badge variant="secondary">Em andamento</Badge>;
  }

  return <Badge variant="default">Concluída</Badge>;
}

export default function Sources() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"activecampaign" | "manychat" | "uchat" | null>(null);
  const [syncingState, setSyncingState] = useState<Record<SyncSource, boolean>>({
    activecampaign: false,
    uchat: false,
  });

  const [acApiUrl, setAcApiUrl] = useState("");
  const [acApiKey, setAcApiKey] = useState("");
  const [acListId, setAcListId] = useState("");
  const [acNamedTags, setAcNamedTags] = useState<NamedTag[]>([]);

  const [manychatApiUrl, setManychatApiUrl] = useState("");
  const [manychatApiKey, setManychatApiKey] = useState("");
  const [manychatAccountId, setManychatAccountId] = useState("");

  const [uchatWorkspaces, setUchatWorkspaces] = useState<UChatWorkspace[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRunRow[]>([]);

  const loadSyncRuns = async (launchId: string, silent = false) => {
    const { data, error } = await supabase
      .from("platform_sync_runs")
      .select(
        "id, source, status, processed_count, created_count, merged_count, error_count, skipped_count, started_at, finished_at, last_error, metadata",
      )
      .eq("launch_id", launchId)
      .order("started_at", { ascending: false })
      .limit(12);

    if (error) {
      if (!silent) {
        toast({ title: "Erro ao carregar sincronizações", description: error.message, variant: "destructive" });
      }
      setSyncRuns([]);
      return [] as SyncRunRow[];
    }

    const fetchedRows = (data || []) as SyncRunRow[];
    const normalizedRows = fetchedRows.map((run) => normalizeSyncRun(run));
    const staleRunIds = normalizedRows
      .filter((run, index) => fetchedRows[index].status === "running" && run.status === "failed")
      .map((run) => run.id);

    if (staleRunIds.length > 0) {
      void supabase
        .from("platform_sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          last_error: STALE_SYNC_ERROR_MESSAGE,
        })
        .in("id", staleRunIds)
        .eq("launch_id", launchId);
    }

    setSyncRuns(normalizedRows);

    const nextSyncingState: Record<SyncSource, boolean> = {
      activecampaign: false,
      uchat: false,
    };

    (["activecampaign", "uchat"] as SyncSource[]).forEach((source) => {
      const latestRun = normalizedRows.find((run) => run.source === source) || null;
      const backendStillRunning = latestRun?.status === "running";

      if (latestRun?.status === "completed" || latestRun?.status === "failed") {
        clearPendingSync(launchId, source);
      }

      nextSyncingState[source] = backendStillRunning || hasPendingSync(launchId, source);
    });

    setSyncingState(nextSyncingState);
    return normalizedRows;
  };

  useEffect(() => {
    if (!activeLaunch || loading) return;

    const draft: SourcesDraft = {
      acApiUrl,
      acApiKey,
      acListId,
      acNamedTags,
      manychatApiUrl,
      manychatApiKey,
      manychatAccountId,
      uchatWorkspaces,
    };

    localStorage.setItem(sourcesDraftStorageKey(activeLaunch.id), JSON.stringify(draft));
  }, [
    acApiKey,
    acApiUrl,
    acListId,
    acNamedTags,
    activeLaunch,
    loading,
    manychatAccountId,
    manychatApiKey,
    manychatApiUrl,
    uchatWorkspaces,
  ]);

  useEffect(() => {
    const load = async () => {
      if (!activeLaunch) {
        setLoading(false);
        setAcApiUrl("");
        setAcApiKey("");
        setAcListId("");
        setAcNamedTags([]);
        setManychatApiUrl("");
        setManychatApiKey("");
        setManychatAccountId("");
        setUchatWorkspaces([]);
        setSyncRuns([]);
        setSyncingState({ activecampaign: false, uchat: false });
        return;
      }

      setLoading(true);

      const [
        { data: launchData, error: launchError },
        { data: workspaceData, error: workspaceError },
      ] = await Promise.all([
        supabase
          .from("launches")
          .select(
            "ac_api_url, ac_api_key, ac_default_list_id, ac_named_tags, manychat_api_url, manychat_api_key, manychat_account_id",
          )
          .eq("id", activeLaunch.id)
          .single(),
        supabase
          .from("uchat_workspaces")
          .select("*")
          .eq("launch_id", activeLaunch.id)
          .order("created_at", { ascending: true }),
      ]);

      if (launchError) {
        toast({ title: "Erro ao carregar fontes", description: launchError.message, variant: "destructive" });
      }

      if (workspaceError) {
        toast({ title: "Erro ao carregar UChat", description: workspaceError.message, variant: "destructive" });
      }

      const backendWorkspaces =
        workspaceData?.map((workspace) => ({
          id: workspace.id,
          workspace_name: workspace.workspace_name,
          workspace_id: workspace.workspace_id,
          bot_id: workspace.bot_id || workspace.workspace_id,
          api_token: workspace.api_token,
          max_subscribers: workspace.max_subscribers,
          current_count: workspace.current_count,
        })) ?? [];

      const draft = loadSourcesDraft(activeLaunch.id);

      setAcApiUrl(draft?.acApiUrl ?? launchData?.ac_api_url ?? "");
      setAcApiKey(draft?.acApiKey ?? launchData?.ac_api_key ?? "");
      setAcListId(draft?.acListId ?? launchData?.ac_default_list_id ?? "");
      setAcNamedTags(
        draft?.acNamedTags ??
          (Array.isArray(launchData?.ac_named_tags) ? (launchData.ac_named_tags as unknown as NamedTag[]) : []),
      );

      setManychatApiUrl(draft?.manychatApiUrl ?? launchData?.manychat_api_url ?? "");
      setManychatApiKey(draft?.manychatApiKey ?? launchData?.manychat_api_key ?? "");
      setManychatAccountId(draft?.manychatAccountId ?? launchData?.manychat_account_id ?? "");
      setUchatWorkspaces(draft?.uchatWorkspaces ?? backendWorkspaces);

      await loadSyncRuns(activeLaunch.id, true);
      setLoading(false);
    };

    void load();
  }, [activeLaunch, toast]);

  useEffect(() => {
    if (!activeLaunch) return;

    const hasOngoingSync =
      syncingState.activecampaign || syncingState.uchat || syncRuns.some((run) => normalizeSyncRun(run).status === "running");

    if (!hasOngoingSync) return;

    const intervalId = window.setInterval(() => {
      void loadSyncRuns(activeLaunch.id, true);
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [activeLaunch, syncingState, syncRuns]);

  const saveActiveCampaign = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!activeLaunch) return false;

    setSaving("activecampaign");
    const { error } = await supabase
      .from("launches")
      .update({
        ac_api_url: acApiUrl || null,
        ac_api_key: acApiKey || null,
        ac_default_list_id: acListId || null,
        ac_named_tags: acNamedTags as unknown as import("@/integrations/supabase/types").Json,
      })
      .eq("id", activeLaunch.id);

    if (error) {
      if (!silent) {
        toast({ title: "Erro ao salvar ActiveCampaign", description: error.message, variant: "destructive" });
      }
      setSaving(null);
      return false;
    }

    if (!silent) {
      toast({ title: "ActiveCampaign atualizado" });
    }
    setSaving(null);
    return true;
  };

  const saveManyChat = async () => {
    if (!activeLaunch) return;

    setSaving("manychat");
    const { error } = await supabase
      .from("launches")
      .update({
        manychat_api_url: manychatApiUrl || null,
        manychat_api_key: manychatApiKey || null,
        manychat_account_id: manychatAccountId || null,
      })
      .eq("id", activeLaunch.id);

    if (error) {
      toast({ title: "Erro ao salvar ManyChat", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "ManyChat atualizado" });
    }
    setSaving(null);
  };

  const saveUChat = async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!activeLaunch) return false;

    setSaving("uchat");

    const { error: deleteError } = await supabase.from("uchat_workspaces").delete().eq("launch_id", activeLaunch.id);

    if (deleteError) {
      if (!silent) {
        toast({ title: "Erro ao limpar workspaces antigos", description: deleteError.message, variant: "destructive" });
      }
      setSaving(null);
      return false;
    }

    const rows = uchatWorkspaces
      .filter((workspace) => workspace.workspace_id.trim() && workspace.api_token.trim())
      .map((workspace) => ({
        launch_id: activeLaunch.id,
        workspace_name: workspace.workspace_name.trim() || `Workspace ${workspace.workspace_id.trim()}`,
        workspace_id: workspace.workspace_id.trim(),
        bot_id: workspace.bot_id.trim() || workspace.workspace_id.trim(),
        api_token: workspace.api_token.trim(),
        max_subscribers: workspace.max_subscribers || 1000,
        current_count: workspace.current_count,
      }));

    if (rows.length > 0) {
      const { data: insertedRows, error: insertError } = await supabase
        .from("uchat_workspaces")
        .insert(rows)
        .select("*");

      if (insertError) {
        if (!silent) {
          toast({ title: "Erro ao salvar UChat", description: insertError.message, variant: "destructive" });
        }
        setSaving(null);
        return false;
      }

      setUchatWorkspaces(
        (insertedRows || []).map((workspace) => ({
          id: workspace.id,
          workspace_name: workspace.workspace_name,
          workspace_id: workspace.workspace_id,
          bot_id: workspace.bot_id,
          api_token: workspace.api_token,
          max_subscribers: workspace.max_subscribers,
          current_count: workspace.current_count,
        })),
      );
    } else {
      setUchatWorkspaces([emptyUChatWorkspace]);
    }

    if (!silent) {
      toast({ title: "UChat atualizado" });
    }
    setSaving(null);
    return true;
  };

  const activeCampaignConnected = Boolean(acApiUrl.trim() && acApiKey.trim());
  const manyChatConnected = Boolean(manychatApiUrl.trim() && manychatApiKey.trim());
  const uchatConnected = uchatWorkspaces.some((workspace) => workspace.workspace_id.trim() && workspace.api_token.trim());

  const latestActiveCampaignRun = useMemo(
    () => syncRuns.find((run) => run.source === "activecampaign") || null,
    [syncRuns],
  );
  const latestUchatRun = useMemo(
    () => syncRuns.find((run) => run.source === "uchat") || null,
    [syncRuns],
  );

  const triggerSync = async (source: SyncSource) => {
    if (!activeLaunch) return;

    if (source === "activecampaign" && !activeCampaignConnected) {
      toast({
        title: "Configure o ActiveCampaign antes",
        description: "Preencha API URL e API Key do ActiveCampaign antes de importar a base.",
        variant: "destructive",
      });
      return;
    }

    if (source === "uchat" && !uchatConnected) {
      toast({
        title: "Configure o UChat antes",
        description: "Preencha ao menos o Workspace ID e o API Token antes de importar os subscribers.",
        variant: "destructive",
      });
      return;
    }

    const saveSucceeded =
      source === "activecampaign"
        ? await saveActiveCampaign({ silent: true })
        : await saveUChat({ silent: true });

    if (!saveSucceeded) return;

    setSyncingState((current) => ({ ...current, [source]: true }));
    markPendingSync(activeLaunch.id, source);
    const requestStartedAt = Date.now();

    try {
      const { data, error } = await supabase.functions.invoke("sync-platform-contacts", {
        body: {
          launchId: activeLaunch.id,
          source,
        },
      });

      if (error) {
        const refreshedRuns = await loadSyncRuns(activeLaunch.id, true);
        const latestRun =
          refreshedRuns.find(
            (run) => run.source === source && new Date(run.started_at).getTime() >= requestStartedAt - 15000,
          ) || null;

        if (latestRun?.status === "running") {
          toast({
            title: source === "activecampaign" ? "Importacao do ActiveCampaign em andamento" : "Importacao do UChat em andamento",
            description: "A rodada foi aberta no backend. Acompanhe a fila e os logs enquanto o processamento continua.",
          });
          return;
        }

        if (latestRun?.status === "completed") {
          toast({
            title: source === "activecampaign" ? "Importacao do ActiveCampaign concluida" : "Importacao do UChat concluida",
            description: `Novos: ${latestRun.created_count} | Mesclados: ${latestRun.merged_count} | Ignorados: ${latestRun.skipped_count} | Erros: ${latestRun.error_count}`,
          });
          return;
        }

        toast({
          title: `Erro ao importar ${source === "activecampaign" ? "ActiveCampaign" : "UChat"}`,
          description: latestRun?.last_error || error.message,
          variant: "destructive",
        });
        return;
      }

      const summary = data as {
        counters?: {
          createdCount?: number;
          mergedCount?: number;
          skippedCount?: number;
          errorCount?: number;
        };
      };

      toast({
        title: source === "activecampaign" ? "Importacao do ActiveCampaign concluida" : "Importacao do UChat concluida",
        description: `Novos: ${summary.counters?.createdCount ?? 0} | Mesclados: ${summary.counters?.mergedCount ?? 0} | Ignorados: ${summary.counters?.skippedCount ?? 0} | Erros: ${summary.counters?.errorCount ?? 0}`,
      });
    } catch (error) {
      const refreshedRuns = await loadSyncRuns(activeLaunch.id, true);
      const latestRun =
        refreshedRuns.find(
          (run) => run.source === source && new Date(run.started_at).getTime() >= requestStartedAt - 15000,
        ) || null;

      if (latestRun?.status === "running") {
        toast({
          title: source === "activecampaign" ? "Importacao do ActiveCampaign em andamento" : "Importacao do UChat em andamento",
          description: "A rodada foi aberta no backend. Acompanhe a fila e os logs enquanto o processamento continua.",
        });
        return;
      }

      if (latestRun?.status === "completed") {
        toast({
          title: source === "activecampaign" ? "Importacao do ActiveCampaign concluida" : "Importacao do UChat concluida",
          description: `Novos: ${latestRun.created_count} | Mesclados: ${latestRun.merged_count} | Ignorados: ${latestRun.skipped_count} | Erros: ${latestRun.error_count}`,
        });
        return;
      }

      const message = error instanceof Error ? error.message : "Falha inesperada ao iniciar a importação.";
      toast({
        title: `Erro ao importar ${source === "activecampaign" ? "ActiveCampaign" : "UChat"}`,
        description: latestRun?.last_error || message,
        variant: "destructive",
      });
    } finally {
      await loadSyncRuns(activeLaunch.id, true);
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
            <CardTitle>Selecione um lançamento</CardTitle>
            <CardDescription>
              Escolha um lançamento na barra lateral para configurar as credenciais das bases conectadas.
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
              Centralize as credenciais do lançamento <span className="font-medium text-foreground">{activeLaunch.name}</span>.
            </p>
          </div>
        </div>
        <Badge variant="outline">{activeLaunch.slug || "sem-slug"}</Badge>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-6">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
          <div className="space-y-1">
            <p className="font-medium">Hub de integrações do lançamento</p>
            <p className="text-sm text-muted-foreground">
              Aqui você conecta as bases de ActiveCampaign, ManyChat e UChat sem espalhar configuração pela interface.
            </p>
          </div>
        </CardContent>
      </Card>

      <SupabaseConnectionCard
        title="Projeto Supabase do app"
        description="Veja qual backend Supabase está ativo, desconecte o override atual ou conecte outro projeto usando apenas o token da conta."
      />

      <SchemaSetupCard
        title="Bootstrap do schema"
        description="Se esse projeto Supabase ainda não recebeu as migrations, copie o SQL ou o prompt do Lovable para subir a estrutura do app."
      />

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
                  Base principal do lançamento. Importa contatos, listas e tags para o hub antes do tratamento automático.
                </CardDescription>
              </div>
              <ConnectionBadge connected={activeCampaignConnected} />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ac-url">API URL</Label>
                <Input
                  id="ac-url"
                  value={acApiUrl}
                  onChange={(event) => setAcApiUrl(event.target.value)}
                  placeholder="https://sua-conta.api-us1.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ac-key">API Key</Label>
                <Input
                  id="ac-key"
                  type="password"
                  value={acApiKey}
                  onChange={(event) => setAcApiKey(event.target.value)}
                  placeholder="Cole a chave da API"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ac-list-id">Lista padrão</Label>
                <Input
                  id="ac-list-id"
                  value={acListId}
                  onChange={(event) => setAcListId(event.target.value)}
                  placeholder="Ex: 1"
                />
              </div>
              <div className="space-y-2">
                <Label>Tags nomeadas</Label>
                <NamedTagsEditor tags={acNamedTags} onChange={setAcNamedTags} />
              </div>
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                   <span className="font-medium text-foreground">Última importação</span>
                  <SyncRunBadge run={latestActiveCampaignRun} />
                </div>
                {latestActiveCampaignRun ? (
                  <div className="mt-3 space-y-1">
                    <p>
                      Processados: {normalizeSyncRun(latestActiveCampaignRun).processed_count} | Novos: {normalizeSyncRun(latestActiveCampaignRun).created_count} | Mesclados:{" "}
                      {normalizeSyncRun(latestActiveCampaignRun).merged_count}
                    </p>
                    <p>
                      Ignorados: {normalizeSyncRun(latestActiveCampaignRun).skipped_count} | Erros: {normalizeSyncRun(latestActiveCampaignRun).error_count}
                    </p>
                    <p>Início: {new Date(latestActiveCampaignRun.started_at).toLocaleString("pt-BR")}</p>
                    {normalizeSyncRun(latestActiveCampaignRun).last_error && (
                      <p className="text-destructive">Último erro: {normalizeSyncRun(latestActiveCampaignRun).last_error}</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3">Quando você importar a base, o resumo da rodada vai aparecer aqui.</p>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap justify-end gap-3">
              <Button
                onClick={() => void triggerSync("activecampaign")}
                disabled={saving !== null || syncingState.activecampaign || syncingState.uchat}
              >
                {syncingState.activecampaign ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DownloadCloud className="mr-2 h-4 w-4" />}
                Importar contatos, listas e tags
              </Button>
              <Button
                onClick={() => void saveActiveCampaign()}
                disabled={saving !== null || syncingState.activecampaign || syncingState.uchat}
              >
                {saving === "activecampaign" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar ActiveCampaign
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-xl">ManyChat</CardTitle>
                <CardDescription>Use um token central para ler e sincronizar a base do ManyChat.</CardDescription>
              </div>
              <ConnectionBadge connected={manyChatConnected} />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="manychat-url">API URL</Label>
                <Input
                  id="manychat-url"
                  value={manychatApiUrl}
                  onChange={(event) => setManychatApiUrl(event.target.value)}
                  placeholder="https://api.manychat.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manychat-key">API Token</Label>
                <Input
                  id="manychat-key"
                  type="password"
                  value={manychatApiKey}
                  onChange={(event) => setManychatApiKey(event.target.value)}
                  placeholder="Cole o token da API"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="manychat-account">Workspace ou conta</Label>
                <Input
                  id="manychat-account"
                  value={manychatAccountId}
                  onChange={(event) => setManychatAccountId(event.target.value)}
                  placeholder="ID interno da conta, inbox ou workspace"
                />
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={saveManyChat} disabled={saving !== null}>
                {saving === "manychat" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar ManyChat
              </Button>
            </CardFooter>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-xl">UChat</CardTitle>
                <CardDescription>
                  Informe o Workspace ID e o API Token. O restante da configuração técnica é preenchido automaticamente.
                </CardDescription>
              </div>
              <ConnectionBadge connected={uchatConnected} />
            </CardHeader>
            <CardContent className="space-y-4">
              <UChatWorkspacesEditor
                workspaces={uchatWorkspaces.length > 0 ? uchatWorkspaces : [emptyUChatWorkspace]}
                onChange={setUchatWorkspaces}
              />
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">Última importação</span>
                  <SyncRunBadge run={latestUchatRun} />
                </div>
                {latestUchatRun ? (
                  <div className="mt-3 space-y-1">
                    <p>
                      Processados: {normalizeSyncRun(latestUchatRun).processed_count} | Novos: {normalizeSyncRun(latestUchatRun).created_count} | Mesclados: {normalizeSyncRun(latestUchatRun).merged_count}
                    </p>
                    <p>
                      Ignorados: {normalizeSyncRun(latestUchatRun).skipped_count} | Erros: {normalizeSyncRun(latestUchatRun).error_count}
                    </p>
                     <p>Início: {new Date(latestUchatRun.started_at).toLocaleString("pt-BR")}</p>
                     {normalizeSyncRun(latestUchatRun).last_error && <p className="text-destructive">Último erro: {normalizeSyncRun(latestUchatRun).last_error}</p>}
                  </div>
                ) : (
                  <p className="mt-3">Use o importador para puxar os subscribers de cada workspace configurado.</p>
                )}
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap justify-end gap-3">
              <Button
                onClick={() => void triggerSync("uchat")}
                disabled={saving !== null || syncingState.activecampaign || syncingState.uchat}
              >
                {syncingState.uchat ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <DownloadCloud className="mr-2 h-4 w-4" />}
                Importar subscribers do UChat
              </Button>
              <Button
                onClick={() => void saveUChat()}
                disabled={saving !== null || syncingState.activecampaign || syncingState.uchat}
              >
                {saving === "uchat" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar UChat
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}

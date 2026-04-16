import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLaunch } from "@/contexts/LaunchContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { normalizeSyncRun, STALE_SYNC_ERROR_MESSAGE } from "@/lib/syncRuns";
import { ListOrdered, Loader2 } from "lucide-react";

type SyncSource = "activecampaign" | "uchat";
type SyncStatus = "running" | "completed" | "failed";

interface SyncRunRow {
  id: string;
  source: SyncSource;
  status: SyncStatus;
  processed_count: number;
  created_count: number;
  merged_count: number;
  error_count: number;
  skipped_count: number;
  started_at: string;
  finished_at: string | null;
  last_error: string | null;
}

interface ProcessingLogRow {
  id: string;
  code: string;
  created_at: string;
  level: "info" | "warning" | "error" | "success";
  message: string;
  source: "activecampaign" | "manychat" | "uchat" | "manual";
  title: string;
}

function statusVariant(status: SyncStatus): "default" | "secondary" | "destructive" {
  if (status === "failed") return "destructive";
  if (status === "running") return "secondary";
  return "default";
}

export default function Queue() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<SyncRunRow[]>([]);
  const [logs, setLogs] = useState<ProcessingLogRow[]>([]);

  useEffect(() => {
    let mounted = true;

    const load = async (silent = false) => {
      if (!activeLaunch) {
        if (mounted) {
          setRuns([]);
          setLogs([]);
          setLoading(false);
        }
        return;
      }

      if (!silent && mounted) {
        setLoading(true);
      }

      const [
        { data: syncData, error: syncError },
        { data: logData, error: logError },
      ] = await Promise.all([
        supabase
          .from("platform_sync_runs")
          .select("id, source, status, processed_count, created_count, merged_count, error_count, skipped_count, started_at, finished_at, last_error")
          .eq("launch_id", activeLaunch.id)
          .order("started_at", { ascending: false })
          .limit(12),
        supabase
          .from("contact_processing_logs")
          .select("id, code, created_at, level, message, source, title")
          .eq("launch_id", activeLaunch.id)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (!silent && (syncError || logError)) {
        toast({
          title: "Erro ao carregar a fila",
          description: syncError.message || logError.message || "Não foi possível carregar o estado da importação.",
          variant: "destructive",
        });
      }

      if (mounted) {
        const fetchedRuns = (syncData || []) as SyncRunRow[];
        const normalizedRuns = fetchedRuns.map((run) => normalizeSyncRun(run));
        const staleRunIds = normalizedRuns
          .filter((run, index) => fetchedRuns[index].status === "running" && run.status === "failed")
          .map((run) => run.id);

        if (staleRunIds.length > 0 && activeLaunch) {
          void supabase
            .from("platform_sync_runs")
            .update({
              status: "failed",
              finished_at: new Date().toISOString(),
              last_error: STALE_SYNC_ERROR_MESSAGE,
            })
            .in("id", staleRunIds)
            .eq("launch_id", activeLaunch.id);
        }

        setRuns(normalizedRuns);
        setLogs((logData || []) as ProcessingLogRow[]);
        setLoading(false);
      }
    };

    void load();

    const intervalId = window.setInterval(() => {
      void load(true);
    }, 4000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [activeLaunch, toast]);

  const runningRuns = useMemo(() => runs.filter((run) => normalizeSyncRun(run).status === "running"), [runs]);

  if (!activeLaunch) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ListOrdered className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Fila</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Selecione um lançamento</CardTitle>
            <CardDescription>Escolha um lançamento para acompanhar as importacoes em andamento.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ListOrdered className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Fila</h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe as rodadas de importação e os eventos recentes do lançamento <span className="font-medium text-foreground">{activeLaunch.name}</span>.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Em andamento</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{runningRuns.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rodadas carregadas</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{runs.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Logs recentes</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{logs.length}</CardContent>
        </Card>
      </div>

      {loading  (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Rodadas de sincronização</CardTitle>
              <CardDescription>A tela atualiza sozinha enquanto houver importação acontecendo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {runs.length === 0  (
                <p className="text-sm text-muted-foreground">Nenhuma importação iniciada ainda para esse lançamento.</p>
              ) : (
                runs.map((run) => (
                  <div key={run.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{run.source === "activecampaign"  "ActiveCampaign" : "UChat"}</p>
                        <Badge variant={statusVariant(normalizeSyncRun(run).status)}>
                          {normalizeSyncRun(run).status === "running"  "Em andamento" : normalizeSyncRun(run).status === "failed"  "Falhou" : "Concluída"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{new Date(run.started_at).toLocaleString("pt-BR")}</p>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                      <p>Processados: {run.processed_count}</p>
                      <p>Novos: {run.created_count}</p>
                      <p>Mesclados: {run.merged_count}</p>
                      <p>Erros: {run.error_count}</p>
                    </div>

                    {normalizeSyncRun(run).last_error && <p className="mt-3 text-sm text-destructive">Último erro: {normalizeSyncRun(run).last_error}</p>}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Eventos recentes</CardTitle>
              <CardDescription>Os logs também atualizam automáticamente enquanto a importação roda.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {logs.length === 0  (
                <p className="text-sm text-muted-foreground">Nenhum evento recente ainda.</p>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium">{log.title}</p>
                        <p className="text-sm text-muted-foreground">{log.message}</p>
                      </div>
                      <div className="text-right">
                        <Badge variant="outline">{log.source}</Badge>
                        <p className="mt-2 text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString("pt-BR")}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

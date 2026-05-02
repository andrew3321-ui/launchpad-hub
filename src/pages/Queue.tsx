import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLaunch } from "@/contexts/LaunchContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ListOrdered, Loader2 } from "lucide-react";

type EventSource =
  | "activecampaign"
  | "manychat"
  | "typebot"
  | "tally"
  | "sendflow"
  | "uchat"
  | "manual";
type EventStatus = "pending" | "processed" | "ignored" | "error";
type ActionStatus = "pending" | "success" | "failed" | "skipped";
type JobStatus = "pending" | "running" | "success" | "failed" | "retrying" | "dead_letter";

interface EventRow {
  id: string;
  source: EventSource;
  event_type: string;
  processing_status: EventStatus;
  received_at: string;
  processing_summary: Record<string, unknown> | null;
}

interface ActionRow {
  id: string;
  source: EventSource;
  target: string;
  action_type: string;
  status: ActionStatus;
  action_key: string | null;
  created_at: string;
  error_message: string | null;
}

interface WebhookJobRow {
  id: string;
  source: EventSource;
  event_type: string | null;
  status: JobStatus;
  attempts: number;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  last_error: string | null;
  dedupe_key: string | null;
}

function statusVariant(status: ActionStatus | EventStatus | JobStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed" || status === "error" || status === "dead_letter") return "destructive";
  if (status === "pending" || status === "running" || status === "retrying") return "secondary";
  if (status === "ignored" || status === "skipped") return "outline";
  return "default";
}

export default function Queue() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();
  const activeLaunchId = activeLaunch?.id ?? null;
  const activeCycleNumber = activeLaunch?.current_cycle_number ?? null;
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<WebhookJobRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loadedLaunchId, setLoadedLaunchId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async (silent = false) => {
      if (!activeLaunchId || activeCycleNumber === null) {
        if (mounted) {
          setJobs([]);
          setEvents([]);
          setActions([]);
          setLoadedLaunchId(null);
          setLoading(false);
        }
        return;
      }

      const launchId = activeLaunchId;

      if (!silent && mounted) {
        setJobs([]);
        setEvents([]);
        setActions([]);
        setLoadedLaunchId(null);
        setLoading(true);
      }

      const [
        { data: jobData, error: jobError },
        { data: eventData, error: eventError },
        { data: actionData, error: actionError },
      ] = await Promise.all([
        supabase
          .from("launch_webhook_jobs")
          .select("id, source, event_type, status, attempts, next_attempt_at, created_at, updated_at, last_error, dedupe_key")
          .eq("launch_id", launchId)
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("inbound_contact_events")
          .select("id, source, event_type, processing_status, received_at, processing_summary")
          .eq("launch_id", launchId)
          .eq("cycle_number", activeCycleNumber)
          .order("received_at", { ascending: false })
          .limit(20),
        supabase
          .from("contact_routing_actions")
          .select("id, source, target, action_type, status, action_key, created_at, error_message")
          .eq("launch_id", launchId)
          .eq("cycle_number", activeCycleNumber)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);

      if (!silent && (jobError || eventError || actionError)) {
        toast({
          title: "Erro ao carregar a fila",
          description:
            jobError?.message ||
            eventError?.message ||
            actionError?.message ||
            "Não foi possivel carregar a fila operacional.",
          variant: "destructive",
        });
      }

      if (mounted) {
        setJobs((jobData || []) as WebhookJobRow[]);
        setEvents((eventData || []) as EventRow[]);
        setActions((actionData || []) as ActionRow[]);
        setLoadedLaunchId(launchId);
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
  }, [activeCycleNumber, activeLaunchId, toast]);

  const visibleJobs = loadedLaunchId === activeLaunchId ? jobs : [];
  const visibleEvents = loadedLaunchId === activeLaunchId ? events : [];
  const visibleActions = loadedLaunchId === activeLaunchId ? actions : [];

  const pendingActions = useMemo(
    () =>
      visibleActions.filter((action) => action.status === "pending").length +
      visibleJobs.filter((job) => ["pending", "running", "retrying"].includes(job.status)).length,
    [visibleActions, visibleJobs],
  );

  if (!activeLaunch) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <ListOrdered className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Fila</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Selecione um expert</CardTitle>
            <CardDescription>
              Escolha um expert para acompanhar os webhooks recebidos e as ações que o
              Launch Hub esta disparando.
            </CardDescription>
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
            Acompanhe os webhooks e o roteamento em tempo real do expert{" "}
            <span className="font-medium text-foreground">{activeLaunch.name}</span>, ciclo #
            {activeLaunch.current_cycle_number}.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Jobs de webhook</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{visibleJobs.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Eventos recebidos</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{visibleEvents.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ações registradas</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{visibleActions.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pendentes agora</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{pendingActions}</CardContent>
        </Card>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Jobs de webhook</CardTitle>
              <CardDescription>
                Status claro da fila assíncrona antes de processar ActiveCampaign, UChat e Google Sheets.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {visibleJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum job de webhook recebido ainda para esse expert.
                </p>
              ) : (
                visibleJobs.map((job) => (
                  <div key={job.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{job.source}</p>
                          <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                          <Badge variant="outline">{job.event_type || "webhook"}</Badge>
                          <Badge variant="secondary">{job.attempts} tentativa{job.attempts === 1 ? "" : "s"}</Badge>
                        </div>
                        {job.next_attempt_at && (
                          <p className="text-xs text-muted-foreground">
                            Proxima tentativa: {new Date(job.next_attempt_at).toLocaleString("pt-BR")}
                          </p>
                        )}
                        {job.dedupe_key && (
                          <p className="break-all text-xs text-muted-foreground">{job.dedupe_key}</p>
                        )}
                        {job.last_error && (
                          <p className="text-sm text-destructive">{job.last_error}</p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(job.created_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Webhooks recentes</CardTitle>
              <CardDescription>
                Cada evento recebido vira uma entrada na fila antes de passar pela base canônica.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {visibleEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum webhook recebido ainda para esse expert neste ciclo.
                </p>
              ) : (
                visibleEvents.map((event) => (
                  <div key={event.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{event.source}</p>
                        <Badge variant={statusVariant(event.processing_status)}>
                          {event.processing_status}
                        </Badge>
                        <Badge variant="outline">{event.event_type}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.received_at).toLocaleString("pt-BR")}
                      </p>
                    </div>
                    {event.processing_summary && (
                      <pre className="mt-3 overflow-x-auto whitespace-pré-wrap rounded-lg border bg-muted/20 p-3 text-xs">
                        {JSON.stringify(event.processing_summary, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ações disparadas</CardTitle>
              <CardDescription>
                Aqui ficam as saidas que o Launch Hub tentou mandar para ActiveCampaign e UChat.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {visibleActions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma ação de roteamento ainda para esse expert neste ciclo.
                </p>
              ) : (
                visibleActions.map((action) => (
                  <div key={action.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {action.source} -&gt; {action.target}
                          </p>
                          <Badge variant={statusVariant(action.status)}>{action.status}</Badge>
                          <Badge variant="outline">{action.action_type}</Badge>
                        </div>
                        {action.action_key && (
                          <p className="text-xs text-muted-foreground">{action.action_key}</p>
                        )}
                        {action.error_message && (
                          <p className="text-sm text-destructive">{action.error_message}</p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(action.created_at).toLocaleString("pt-BR")}
                      </p>
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

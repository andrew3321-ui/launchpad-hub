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

function statusVariant(status: ActionStatus | EventStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed" || status === "error") return "destructive";
  if (status === "pending") return "secondary";
  if (status === "ignored" || status === "skipped") return "outline";
  return "default";
}

export default function Queue() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();
  const activeLaunchId = activeLaunch?.id ?? null;
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loadedLaunchId, setLoadedLaunchId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async (silent = false) => {
      if (!activeLaunchId) {
        if (mounted) {
          setEvents([]);
          setActions([]);
          setLoadedLaunchId(null);
          setLoading(false);
        }
        return;
      }

      const launchId = activeLaunchId;

      if (!silent && mounted) {
        setEvents([]);
        setActions([]);
        setLoadedLaunchId(null);
        setLoading(true);
      }

      const [
        { data: eventData, error: eventError },
        { data: actionData, error: actionError },
      ] = await Promise.all([
        supabase
          .from("inbound_contact_events")
          .select("id, source, event_type, processing_status, received_at, processing_summary")
          .eq("launch_id", launchId)
          .order("received_at", { ascending: false })
          .limit(20),
        supabase
          .from("contact_routing_actions")
          .select("id, source, target, action_type, status, action_key, created_at, error_message")
          .eq("launch_id", launchId)
          .order("created_at", { ascending: false })
          .limit(30),
      ]);

      if (!silent && (eventError || actionError)) {
        toast({
          title: "Erro ao carregar a fila",
          description:
            eventError?.message ||
            actionError?.message ||
            "Nao foi possivel carregar a fila operacional.",
          variant: "destructive",
        });
      }

      if (mounted) {
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
  }, [activeLaunchId, toast]);

  const visibleEvents = loadedLaunchId === activeLaunchId ? events : [];
  const visibleActions = loadedLaunchId === activeLaunchId ? actions : [];

  const pendingActions = useMemo(
    () => visibleActions.filter((action) => action.status === "pending").length,
    [visibleActions],
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
            <CardTitle>Selecione um lancamento</CardTitle>
            <CardDescription>
              Escolha um lancamento para acompanhar os webhooks recebidos e as acoes que o
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
            Acompanhe os webhooks e o roteamento em tempo real do lancamento{" "}
            <span className="font-medium text-foreground">{activeLaunch.name}</span>.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Eventos recebidos</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{visibleEvents.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Acoes registradas</CardTitle>
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
              <CardTitle>Webhooks recentes</CardTitle>
              <CardDescription>
                Cada evento recebido vira uma entrada na fila antes de passar pela base canonica.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {visibleEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum webhook recebido ainda para esse lancamento.
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
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border bg-muted/20 p-3 text-xs">
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
              <CardTitle>Acoes disparadas</CardTitle>
              <CardDescription>
                Aqui ficam as saidas que o Launch Hub tentou mandar para ActiveCampaign e UChat.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {visibleActions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhuma acao de roteamento ainda para esse lancamento.
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

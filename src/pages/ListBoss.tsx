import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLaunch } from "@/contexts/LaunchContext";
import { useToast } from "@/hooks/use-toast";
import { getSupabaseConnectionConfig, supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, Copy, Download, Loader2, RefreshCw, ShoppingBag } from "lucide-react";

interface HotmartSettings {
  launch_id: string;
  enabled: boolean;
  webhook_token: string;
  created_at: string;
  updated_at: string;
}

interface HotmartEventRow {
  id: string;
  launch_id: string;
  cycle_number: number | null;
  event_key: string;
  event_type: string;
  hotmart_event_id: string | null;
  transaction_code: string | null;
  purchase_status: string | null;
  product_id: string | null;
  product_name: string | null;
  offer_code: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  price_amount: number | null;
  price_currency: string | null;
  occurred_at: string | null;
  received_at: string;
  raw_payload: Record<string, unknown> | null;
}

interface DbError {
  message: string;
}

interface QueryResult<T> {
  data: T | null;
  error: DbError | null;
}

interface QueryResultWithCount<T> extends QueryResult<T> {
  count: number | null;
}

interface HotmartEventSelectQuery {
  eq(column: string, value: string): HotmartEventSelectQuery;
  or(filters: string): HotmartEventSelectQuery;
  order(column: string, options: { ascending: boolean }): HotmartEventSelectQuery;
  range(from: number, to: number): Promise<QueryResultWithCount<HotmartEventRow[]>>;
}

interface HotmartSettingsUpdateQuery {
  eq(column: string, value: string): Promise<QueryResult<unknown>>;
}

interface UntypedSupabaseClient {
  rpc<T>(functionName: string, args?: Record<string, unknown>): Promise<QueryResult<T>>;
  from(table: "hotmart_events"): {
    select(columns: string, options?: { count?: "exact" }): HotmartEventSelectQuery;
  };
  from(table: "hotmart_webhook_settings"): {
    update(values: Partial<Pick<HotmartSettings, "enabled">>): HotmartSettingsUpdateQuery;
  };
}

const HOTMART_NO_EVENT_FILTER = "all";
const HOTMART_PAGE_SIZE = 50;
const HOTMART_EXPORT_BATCH_SIZE = 1000;
const HOTMART_EVENT_COLUMNS =
  "id, launch_id, cycle_number, event_key, event_type, hotmart_event_id, transaction_code, purchase_status, product_id, product_name, offer_code, buyer_name, buyer_email, buyer_phone, price_amount, price_currency, occurred_at, received_at, raw_payload";

const eventLabels: Record<string, string> = {
  purchase_approved: "Compra aprovada",
  purchase_complete: "Compra completa",
  purchase_canceled: "Compra cancelada",
  purchase_refunded: "Reembolso",
  purchase_chargeback: "Chargeback",
  purchase_billet_printed: "Boleto gerado",
  purchase_delayed: "Pagamento atrasado",
  purchase_expired: "Compra expirada",
  purchase_protested: "Compra protestada",
  cart_abandoned: "Carrinho abandonado",
  subscription_cancellation: "Assinatura cancelada",
};

function normalizeFilterValue(value: string) {
  return value.trim().replace(/[%,()]/g, " ");
}

function formatEventLabel(eventType: string) {
  const normalized = eventType.toLowerCase();
  if (eventLabels[normalized]) return eventLabels[normalized];

  return eventType
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeCsvValue(value: unknown) {
  if (value === null || value === undefined) return "";

  const text = String(value);
  if (!/[",\n\r;]/.test(text)) return text;

  return `"${text.replace(/"/g, '""')}"`;
}

function formatDateForCsv(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("pt-BR");
}

function buildCsv(events: HotmartEventRow[], expertName: string) {
  const headers = [
    "Expert",
    "Evento",
    "Status",
    "Nome",
    "Email",
    "Telefone",
    "Produto",
    "Produto ID",
    "Oferta",
    "Transacao",
    "Valor",
    "Moeda",
    "Data do evento",
    "Recebido em",
    "Ciclo",
    "Hotmart Event ID",
  ];

  const rows = events.map((event) => [
    expertName,
    formatEventLabel(event.event_type),
    event.purchase_status,
    event.buyer_name,
    event.buyer_email,
    event.buyer_phone,
    event.product_name,
    event.product_id,
    event.offer_code,
    event.transaction_code,
    event.price_amount,
    event.price_currency,
    formatDateForCsv(event.occurred_at),
    formatDateForCsv(event.received_at),
    event.cycle_number,
    event.hotmart_event_id,
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsvValue).join(";")).join("\n");
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([`\uFEFF${content}`], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getEventVariant(eventType: string): "default" | "secondary" | "destructive" | "outline" {
  const normalized = eventType.toLowerCase();
  if (normalized.includes("approved") || normalized.includes("complete")) return "default";
  if (normalized.includes("refund") || normalized.includes("chargeback") || normalized.includes("cancel")) {
    return "destructive";
  }
  if (normalized.includes("abandon") || normalized.includes("billet") || normalized.includes("pending")) {
    return "secondary";
  }

  return "outline";
}

function buildHotmartWebhookUrl(
  launch: { id: string; slug: string | null } | null,
  token: string | null,
) {
  const config = getSupabaseConnectionConfig();
  const expertSlug = launch?.slug || launch?.id;

  if (!config.url || !expertSlug || !token) return "";

  const url = new URL(`${config.url}/functions/v1/hotmart-webhook-router`);
  url.searchParams.set("expertSlug", expertSlug);
  url.searchParams.set("token", token);
  return url.toString();
}

export default function ListBoss() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();
  const db = supabase as unknown as UntypedSupabaseClient;
  const activeLaunchId = activeLaunch?.id ?? null;
  const [settings, setSettings] = useState<HotmartSettings | null>(null);
  const [events, setEvents] = useState<HotmartEventRow[]>([]);
  const [loadedLaunchId, setLoadedLaunchId] = useState<string | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState(HOTMART_NO_EVENT_FILTER);
  const [page, setPage] = useState(1);
  const [totalEvents, setTotalEvents] = useState(0);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const webhookUrl = useMemo(
    () => buildHotmartWebhookUrl(activeLaunch, settings?.webhook_token ?? null),
    [activeLaunch, settings?.webhook_token],
  );

  const loadSettings = useCallback(async () => {
    if (!activeLaunchId) {
      setSettings(null);
      return;
    }

    setLoadingSettings(true);

    const { data, error } = await db.rpc<HotmartSettings[]>("ensure_hotmart_webhook_settings", {
      target_launch_id: activeLaunchId,
    });

    if (error) {
      toast({
        title: "Erro ao carregar webhook Hotmart",
        description: error.message,
        variant: "destructive",
      });
      setLoadingSettings(false);
      return;
    }

    setSettings((data?.[0] ?? null) as HotmartSettings | null);
    setLoadingSettings(false);
  }, [activeLaunchId, db, toast]);

  const buildEventsQuery = useCallback(() => {
    if (!activeLaunchId) return null;

    let query = db
      .from("hotmart_events")
      .select(HOTMART_EVENT_COLUMNS, { count: "exact" })
      .eq("launch_id", activeLaunchId);

    if (eventFilter !== HOTMART_NO_EVENT_FILTER) {
      query = query.eq("event_type", eventFilter);
    }

    const filterValue = normalizeFilterValue(search);
    if (filterValue) {
      const orFilter = [
        "event_type",
        "purchase_status",
        "transaction_code",
        "product_id",
        "product_name",
        "offer_code",
        "buyer_name",
        "buyer_email",
        "buyer_phone",
      ]
        .map((column) => `${column}.ilike.%${filterValue}%`)
        .join(",");

      query = query.or(orFilter);
    }

    return query.order("received_at", { ascending: false });
  }, [activeLaunchId, db, eventFilter, search]);

  const loadEvents = useCallback(async (silent = false) => {
    if (!activeLaunchId) {
      setEvents([]);
      setLoadedLaunchId(null);
      setTotalEvents(0);
      return;
    }

    if (!silent) {
      setLoadingEvents(true);
      setEvents([]);
      setLoadedLaunchId(null);
    }

    const query = buildEventsQuery();
    if (!query) return;

    const from = (page - 1) * HOTMART_PAGE_SIZE;
    const to = from + HOTMART_PAGE_SIZE - 1;
    const { data, error, count } = await query.range(from, to);

    if (error) {
      if (!silent) {
        toast({
          title: "Erro ao carregar eventos Hotmart",
          description: error.message,
          variant: "destructive",
        });
      }
      setLoadingEvents(false);
      return;
    }

    setEvents((data || []) as HotmartEventRow[]);
    setTotalEvents(count ?? 0);
    setLoadedLaunchId(activeLaunchId);
    setLoadingEvents(false);
  }, [activeLaunchId, buildEventsQuery, page, toast]);

  useEffect(() => {
    setPage(1);
    setExpandedEventId(null);
  }, [activeLaunchId, eventFilter, search]);

  useEffect(() => {
    void loadSettings();
    void loadEvents();

    const intervalId = window.setInterval(() => {
      void loadEvents(true);
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, [loadEvents, loadSettings]);

  const visibleEvents = useMemo(
    () => (loadedLaunchId === activeLaunchId ? events : []),
    [activeLaunchId, events, loadedLaunchId],
  );
  const totalPages = Math.max(1, Math.ceil(totalEvents / HOTMART_PAGE_SIZE));
  const firstVisibleIndex = totalEvents === 0 ? 0 : (page - 1) * HOTMART_PAGE_SIZE + 1;
  const lastVisibleIndex = Math.min(page * HOTMART_PAGE_SIZE, totalEvents);

  const eventTypeOptions = useMemo(
    () => Array.from(new Set([...Object.keys(eventLabels), ...visibleEvents.map((event) => event.event_type)])).sort(),
    [visibleEvents],
  );

  const stats = useMemo(() => {
    const approved = visibleEvents.filter((event) => {
      const value = `${event.event_type} ${event.purchase_status || ""}`.toLowerCase();
      return value.includes("approved") || value.includes("complete");
    }).length;
    const abandoned = visibleEvents.filter((event) => event.event_type.toLowerCase().includes("abandon")).length;
    const rejected = visibleEvents.filter((event) => {
      const value = `${event.event_type} ${event.purchase_status || ""}`.toLowerCase();
      return value.includes("refused") || value.includes("rejected") || value.includes("cancel") || value.includes("refund");
    }).length;

    return {
      total: totalEvents,
      pageTotal: visibleEvents.length,
      approved,
      abandoned,
      rejected,
    };
  }, [totalEvents, visibleEvents]);

  const copyWebhookUrl = async () => {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    toast({ title: "Webhook copiado", description: "Cole esta URL no Webhook/Postback da Hotmart." });
  };

  const updateEnabled = async (enabled: boolean) => {
    if (!activeLaunchId || !settings) return;

    setSaving(true);
    const { error } = await db
      .from("hotmart_webhook_settings")
      .update({ enabled })
      .eq("launch_id", activeLaunchId);

    if (error) {
      toast({
        title: "Erro ao atualizar Hotmart",
        description: error.message,
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    setSettings({ ...settings, enabled });
    setSaving(false);
  };

  const regenerateToken = async () => {
    if (!activeLaunchId) return;

    setSaving(true);
    const { data, error } = await db.rpc<HotmartSettings[]>("regenerate_hotmart_webhook_token", {
      target_launch_id: activeLaunchId,
    });

    if (error) {
      toast({
        title: "Erro ao regenerar token",
        description: error.message,
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    setSettings((data?.[0] ?? null) as HotmartSettings | null);
    setSaving(false);
    toast({
      title: "Token regenerado",
      description: "Atualize a URL do webhook na Hotmart para continuar recebendo eventos.",
    });
  };

  const exportCsv = async () => {
    if (!activeLaunchId || !activeLaunch) return;

    setExportingCsv(true);
    const exportedEvents: HotmartEventRow[] = [];

    try {
      let offset = 0;

      while (true) {
        const query = buildEventsQuery();
        if (!query) break;

        const { data, error } = await query.range(offset, offset + HOTMART_EXPORT_BATCH_SIZE - 1);

        if (error) {
          throw new Error(error.message);
        }

        const batch = data || [];
        exportedEvents.push(...batch);

        if (batch.length < HOTMART_EXPORT_BATCH_SIZE) break;
        offset += HOTMART_EXPORT_BATCH_SIZE;
      }

      if (exportedEvents.length === 0) {
        toast({
          title: "Nada para exportar",
          description: "Nenhum evento Hotmart foi encontrado para os filtros atuais.",
        });
        return;
      }

      const filenameExpert = (activeLaunch.slug || activeLaunch.name || "expert")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const csv = buildCsv(exportedEvents, activeLaunch.name);
      downloadTextFile(
        `listboss-hotmart-${filenameExpert}-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
        "text/csv;charset=utf-8",
      );

      toast({
        title: "CSV exportado",
        description: `${exportedEvents.length} evento(s) exportado(s) com os filtros atuais.`,
      });
    } catch (error) {
      toast({
        title: "Erro ao exportar CSV",
        description: error instanceof Error ? error.message : "Nao foi possivel exportar os eventos.",
        variant: "destructive",
      });
    } finally {
      setExportingCsv(false);
    }
  };

  if (!activeLaunch) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <ShoppingBag className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">ListBoss</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Selecione um expert</CardTitle>
            <CardDescription>
              Escolha um expert na barra lateral para configurar o webhook da Hotmart e acompanhar os eventos comerciais.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShoppingBag className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">ListBoss Hotmart</h1>
            <p className="text-sm text-muted-foreground">
              Eventos comerciais do expert <span className="font-medium text-foreground">{activeLaunch.name}</span>, sem misturar com leads e roteamentos.
            </p>
          </div>
        </div>
        <Button variant="outline" className="gap-2" onClick={() => void loadEvents()} disabled={loadingEvents}>
          {loadingEvents ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Webhook da Hotmart</CardTitle>
          <CardDescription>
            Configure esta URL no Webhook/Postback da Hotmart para todos os produtos do expert. O Launch Hub apenas registra os eventos recebidos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loadingSettings ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando configuração...
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-muted/20 p-4">
                <div className="space-y-1">
                  <p className="font-medium">Recebimento de eventos</p>
                  <p className="text-sm text-muted-foreground">
                    Quando ativo, o endpoint aceita eventos da Hotmart com o token abaixo.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={settings?.enabled ? "default" : "secondary"}>
                    {settings?.enabled ? "Ativo" : "Pausado"}
                  </Badge>
                  <Switch checked={Boolean(settings?.enabled)} onCheckedChange={(checked) => void updateEnabled(checked)} disabled={saving} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>URL do webhook</Label>
                <div className="flex flex-col gap-3 lg:flex-row">
                  <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                  <Button type="button" variant="outline" className="gap-2" onClick={copyWebhookUrl} disabled={!webhookUrl}>
                    <Copy className="h-4 w-4" />
                    Copiar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Na Hotmart, selecione os eventos desejados, como compra aprovada, pagamento recusado, reembolso e abandono de carrinho.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-background/40 p-4">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Token do webhook</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{settings?.webhook_token || "-"}</p>
                </div>
                <Button type="button" variant="outline" onClick={regenerateToken} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Regenerar token
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Eventos filtrados</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{stats.total}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Na pagina</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{stats.pageTotal}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aprovadas na pagina</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{stats.approved}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Atencao na pagina</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{stats.abandoned + stats.rejected}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Eventos recebidos</CardTitle>
          <CardDescription>
            Histórico separado dos webhooks de captação. Use os filtros para auditar produto, comprador, transação ou status.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-[1fr_260px_auto]">
            <div className="space-y-2">
              <Label htmlFor="hotmart-search">Buscar</Label>
              <Input
                id="hotmart-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nome, email, produto, transação ou telefone"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de evento</Label>
              <Select value={eventFilter} onValueChange={setEventFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HOTMART_NO_EVENT_FILTER}>Todos</SelectItem>
                  {eventTypeOptions.map((eventType) => (
                    <SelectItem key={eventType} value={eventType}>
                      {formatEventLabel(eventType)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2 xl:w-auto"
                onClick={exportCsv}
                disabled={exportingCsv || loadingEvents || totalEvents === 0}
              >
                {exportingCsv ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Exportar CSV
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-muted/20 p-4 text-sm text-muted-foreground">
            <span>
              Mostrando {firstVisibleIndex}-{lastVisibleIndex} de {totalEvents} evento(s). Pagina {page} de {totalPages}.
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={loadingEvents || page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={loadingEvents || page >= totalPages}
              >
                Proxima
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {loadingEvents ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : visibleEvents.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">
              Nenhum evento Hotmart encontrado para os filtros atuais. Quando a Hotmart enviar um postback para a URL acima, ele aparecerá aqui.
            </div>
          ) : (
            <div className="space-y-4">
              {visibleEvents.map((event) => (
                <div key={event.id} className="rounded-2xl border bg-background/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={getEventVariant(event.event_type)}>{formatEventLabel(event.event_type)}</Badge>
                        {event.purchase_status && <Badge variant="outline">{event.purchase_status}</Badge>}
                        {event.cycle_number && <Badge variant="secondary">Ciclo #{event.cycle_number}</Badge>}
                      </div>
                      <div>
                        <p className="font-medium">{event.buyer_name || event.buyer_email || "Comprador sem nome"}</p>
                        <p className="text-sm text-muted-foreground">
                          {[event.buyer_email, event.buyer_phone].filter(Boolean).join(" · ") || "Sem email/telefone no payload"}
                        </p>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {new Date(event.received_at).toLocaleString("pt-BR")}
                    </p>
                  </div>

                  <div className="mt-4 grid gap-3 text-sm md:grid-cols-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Produto</p>
                      <p className="mt-1 font-medium">{event.product_name || "-"}</p>
                      {event.product_id && <p className="text-xs text-muted-foreground">ID {event.product_id}</p>}
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Transação</p>
                      <p className="mt-1 font-mono text-xs">{event.transaction_code || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Oferta</p>
                      <p className="mt-1">{event.offer_code || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Valor</p>
                      <p className="mt-1">
                        {event.price_amount !== null && event.price_amount !== undefined
                          ? `${event.price_currency || "BRL"} ${Number(event.price_amount).toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}`
                          : "-"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {event.occurred_at && (
                      <span className="text-xs text-muted-foreground">
                        Ocorrido em {new Date(event.occurred_at).toLocaleString("pt-BR")}
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setExpandedEventId((current) => (current === event.id ? null : event.id))}
                    >
                      {expandedEventId === event.id ? "Ocultar payload" : "Ver payload"}
                    </Button>
                  </div>

                  {expandedEventId === event.id && (
                    <pre className="mt-4 max-h-96 overflow-auto rounded-xl border bg-muted/20 p-4 text-xs">
                      {JSON.stringify(event.raw_payload || {}, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

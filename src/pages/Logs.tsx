import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { useLaunch } from "@/contexts/LaunchContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Loader2 } from "lucide-react";

type LogLevel = "info" | "warning" | "error" | "success";
type LogSource =
  | "activecampaign"
  | "manychat"
  | "typebot"
  | "tally"
  | "sendflow"
  | "uchat"
  | "manual";
type LogCategory =
  | "sheets"
  | "uchat"
  | "activecampaign"
  | "dedupe"
  | "webhook"
  | "processing";

interface ProcessingLogRow {
  id: string;
  code: string;
  created_at: string;
  details: Record<string, unknown> | null;
  level: LogLevel;
  message: string;
  source: LogSource;
  title: string;
}

const levelLabels: Record<LogLevel, string> = {
  info: "Info",
  warning: "Alerta",
  error: "Erro",
  success: "Sucesso",
};

const sourceLabels: Record<LogSource, string> = {
  activecampaign: "ActiveCampaign",
  manychat: "ManyChat",
  typebot: "Typebot",
  tally: "Tally",
  sendflow: "Sendflow",
  uchat: "UChat",
  manual: "Manual",
};

const categoryLabels: Record<LogCategory, string> = {
  sheets: "Planilha",
  uchat: "UChat",
  activecampaign: "ActiveCampaign",
  dedupe: "Mesclas",
  webhook: "Webhook",
  processing: "Processamento",
};

function levelVariant(level: LogLevel): "default" | "secondary" | "destructive" | "outline" {
  if (level === "error") return "destructive";
  if (level === "success") return "default";
  if (level === "warning") return "secondary";
  return "outline";
}

function getLogCategory(row: ProcessingLogRow): LogCategory {
  const code = row.code || "";
  const source = row.source || "";

  if (code.startsWith("GOOGLE_SHEETS") || code.startsWith("ACTIVE_SHEETS")) return "sheets";
  if (code.includes("UCHAT") || code.includes("SUBFLOW") || source === "uchat") return "uchat";
  if (code.includes("DUPLICATE") || code.includes("MERGE") || code.includes("DEDUP")) return "dedupe";
  if (code.includes("WEBHOOK") || code.includes("CONTACT_IMPORTED")) return "webhook";
  if (code.includes("ACTIVECAMPAIGN") || code.includes("ACTIVE_") || source === "activecampaign") {
    return "activecampaign";
  }

  return "processing";
}

export default function Logs() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();
  const activeLaunchId = activeLaunch?.id ?? null;
  const activeCycleNumber = activeLaunch?.current_cycle_number ?? null;

  const [rows, setRows] = useState<ProcessingLogRow[]>([]);
  const [loadedLaunchId, setLoadedLaunchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async (silent = false) => {
      if (!activeLaunchId || activeCycleNumber === null) {
        if (mounted) {
          setRows([]);
          setLoadedLaunchId(null);
          setLoading(false);
        }
        return;
      }

      const launchId = activeLaunchId;

      if (!silent && mounted) {
        setRows([]);
        setLoadedLaunchId(null);
        setLoading(true);
      }

      const { data, error } = await supabase
        .from("contact_processing_logs")
        .select("id, code, created_at, details, level, message, source, title")
        .eq("launch_id", launchId)
        .eq("cycle_number", activeCycleNumber)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        if (!silent) {
          toast({ title: "Erro ao carregar logs", description: error.message, variant: "destructive" });
        }

        if (mounted) {
          setLoading(false);
        }
        return;
      }

      if (mounted) {
        setRows((data || []) as ProcessingLogRow[]);
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

  const visibleRows = loadedLaunchId === activeLaunchId ? rows : [];

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return visibleRows.filter((row) => {
      if (levelFilter !== "all" && row.level !== levelFilter) return false;
      if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
      if (categoryFilter !== "all" && getLogCategory(row) !== categoryFilter) return false;

      if (!normalizedSearch) return true;

      const haystack = [
        row.title,
        row.message,
        row.code,
        sourceLabels[row.source],
        categoryLabels[getLogCategory(row)],
        JSON.stringify(row.details || {}),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [visibleRows, categoryFilter, levelFilter, search, sourceFilter]);

  const logStats = useMemo(() => {
    const errors = visibleRows.filter((row) => row.level === "error").length;
    const warnings = visibleRows.filter((row) => row.level === "warning").length;
    const sheets = visibleRows.filter((row) => getLogCategory(row) === "sheets").length;

    return {
      total: visibleRows.length,
      errors,
      warnings,
      sheets,
    };
  }, [visibleRows]);

  if (!activeLaunch) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Logs</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Selecione um expert</CardTitle>
            <CardDescription>
              Escolha um expert na barra lateral para acompanhar os eventos processados e os erros de integracao.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Logs</h1>
          <p className="text-sm text-muted-foreground">
            Veja o que aconteceu com cada contato do expert{" "}
            <span className="font-medium text-foreground">{activeLaunch.name}</span>, ciclo #
            {activeLaunch.current_cycle_number}.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Painel operacional</CardTitle>
          <CardDescription>
            Filtre por fonte, severidade e tipo de evento para encontrar rapidamente erros, envios para planilha e mesclas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Total</p>
              <p className="mt-2 text-2xl font-bold">{logStats.total}</p>
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Planilha</p>
              <p className="mt-2 text-2xl font-bold">{logStats.sheets}</p>
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Alertas</p>
              <p className="mt-2 text-2xl font-bold">{logStats.warnings}</p>
            </div>
            <div className="rounded-2xl border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Erros</p>
              <p className="mt-2 text-2xl font-bold">{logStats.errors}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="search-log">Busca</Label>
              <Input
                id="search-log"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder='Ex: "numero invalido" ou "duplicado"'
              />
            </div>

            <div className="space-y-2">
              <Label>Nivel</Label>
              <Select value={levelFilter} onValueChange={setLevelFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="success">Sucesso</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Alerta</SelectItem>
                  <SelectItem value="error">Erro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="sheets">Planilha</SelectItem>
                  <SelectItem value="uchat">UChat</SelectItem>
                  <SelectItem value="activecampaign">ActiveCampaign</SelectItem>
                  <SelectItem value="dedupe">Mesclas</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                  <SelectItem value="processing">Processamento</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Fonte</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  <SelectItem value="activecampaign">ActiveCampaign</SelectItem>
                  <SelectItem value="manychat">ManyChat</SelectItem>
                  <SelectItem value="typebot">Typebot</SelectItem>
                  <SelectItem value="tally">Tally</SelectItem>
                  <SelectItem value="sendflow">Sendflow</SelectItem>
                  <SelectItem value="uchat">UChat</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filteredRows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">
            Nenhum log encontrado para os filtros atuais. Quando o backend comecar a ingerir contatos, eventos como
            numero invalido, merge de duplicata e importacao aparecerao aqui.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredRows.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-3 p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{row.title}</p>
                      <Badge variant={levelVariant(row.level)}>{levelLabels[row.level]}</Badge>
                      <Badge variant="secondary">{categoryLabels[getLogCategory(row)]}</Badge>
                      <Badge variant="outline">{sourceLabels[row.source]}</Badge>
                      <Badge variant="outline" className="font-mono">
                        {row.code}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{row.message}</p>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleString("pt-BR")}
                  </p>
                </div>

                {row.details && Object.keys(row.details).length > 0 && (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <pre className="overflow-x-auto whitespace-pre-wrap text-xs">
                      {JSON.stringify(row.details, null, 2)}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

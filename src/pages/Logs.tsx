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
type LogSource = "activecampaign" | "manychat" | "uchat" | "manual";

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
  uchat: "UChat",
  manual: "Manual",
};

function levelVariant(level: LogLevel): "default" | "secondary" | "destructive" | "outline" {
  if (level === "error") return "destructive";
  if (level === "success") return "default";
  if (level === "warning") return "secondary";
  return "outline";
}

export default function Logs() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();

  const [rows, setRows] = useState<ProcessingLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let mounted = true;

    const load = async (silent = false) => {
      if (!activeLaunch) {
        if (mounted) {
          setRows([]);
          setLoading(false);
        }
        return;
      }

      if (!silent && mounted) {
        setLoading(true);
      }

      const { data, error } = await supabase
        .from("contact_processing_logs")
        .select("id, code, created_at, details, level, message, source, title")
        .eq("launch_id", activeLaunch.id)
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

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (levelFilter !== "all" && row.level !== levelFilter) return false;
      if (sourceFilter !== "all" && row.source !== sourceFilter) return false;

      if (!normalizedSearch) return true;

      const haystack = [
        row.title,
        row.message,
        row.code,
        sourceLabels[row.source],
        JSON.stringify(row.details || {}),
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [rows, levelFilter, search, sourceFilter]);

  if (!activeLaunch) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Logs</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Selecione um lançamento</CardTitle>
            <CardDescription>
              Escolha um lançamento na barra lateral para acompanhar os eventos processados e os erros de integração.
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
            Veja o que aconteceu com cada contato do lançamento <span className="font-medium text-foreground">{activeLaunch.name}</span>.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Painel operacional</CardTitle>
          <CardDescription>
            Filtre por fonte, severidade e texto para encontrar rapidamente erros como número inválido ou merge de duplicatas.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="search-log">Busca</Label>
            <Input
              id="search-log"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='Ex: "Número inválido" ou "duplicado"'
            />
          </div>

          <div className="space-y-2">
            <Label>Nível</Label>
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
            <Label>Fonte</Label>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="activecampaign">ActiveCampaign</SelectItem>
                <SelectItem value="manychat">ManyChat</SelectItem>
                <SelectItem value="uchat">UChat</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
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
            Nenhum log encontrado para os filtros atuais. Quando o backend começar a ingerir contatos, eventos como número inválido, merge de duplicata e importação aparecerão aqui.
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

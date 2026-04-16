import { useEffect, useState } from "react";
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
import {
  clearRuntimeSupabaseConnection,
  getSupabaseConnectionConfig,
  hasRuntimeSupabaseConnection,
  setRuntimeSupabaseConnection,
  subscribeToSupabaseConnection,
} from "@/integrations/supabase/client";
import {
  buildSupabaseRuntimeConnection,
  listSupabaseProjects,
  type SupabaseManagementProject,
} from "@/lib/supabaseManagement";
import { useToast } from "@/hooks/use-toast";
import { DatabaseZap, Loader2, PlugZap, Unplug } from "lucide-react";

interface Props {
  title?: string;
  description?: string;
}

export function SupabaseConnectionCard({
  title = "Conexao Supabase",
  description = "Conecte outro projeto Supabase por personal access token e troque a base sem rebuild.",
}: Props) {
  const { toast } = useToast();

  const [connection, setConnection] = useState(getSupabaseConnectionConfig());
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<SupabaseManagementProject[]>([]);
  const [selectedProjectRef, setSelectedProjectRef] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    return subscribeToSupabaseConnection((nextConnection) => {
      setConnection(nextConnection);
    });
  }, []);

  const handleFetchProjects = async () => {
    if (!token.trim()) {
      toast({
        title: "Token obrigatorio",
        description: "Informe um personal access token do Supabase para descobrir os projetos disponiveis.",
        variant: "destructive",
      });
      return;
    }

    setLoadingProjects(true);

    try {
      const discoveredProjects = await listSupabaseProjects(token.trim());
      setProjects(discoveredProjects);
      setSelectedProjectRef(discoveredProjects[0]?.ref || "");

      toast({
        title: "Projetos carregados",
        description:
          discoveredProjects.length > 0
            ? `Encontramos ${discoveredProjects.length} projeto(s) nesse token.`
            : "Esse token nao retornou nenhum projeto acessivel.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao consultar os projetos do Supabase.";
      toast({ title: "Erro ao consultar token", description: message, variant: "destructive" });
      setProjects([]);
      setSelectedProjectRef("");
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleConnectProject = async () => {
    if (!token.trim() || !selectedProjectRef) {
      toast({
        title: "Projeto nao selecionado",
        description: "Busque os projetos com o token e selecione o destino antes de conectar.",
        variant: "destructive",
      });
      return;
    }

    const selectedProject = projects.find((project) => project.ref === selectedProjectRef);
    setConnecting(true);

    try {
      const runtimeConnection = await buildSupabaseRuntimeConnection(
        token.trim(),
        selectedProjectRef,
        selectedProject?.name,
      );

      setRuntimeSupabaseConnection(runtimeConnection);
      setToken("");

      toast({
        title: "Projeto conectado",
        description: `O app agora esta apontando para ${runtimeConnection.projectName}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel conectar o projeto selecionado.";
      toast({ title: "Erro ao conectar projeto", description: message, variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    clearRuntimeSupabaseConnection();
    setProjects([]);
    setSelectedProjectRef("");
    setToken("");
    toast({
      title: "Conexao resetada",
      description: "O app voltou a usar o projeto Supabase embutido nas variaveis de ambiente.",
    });
  };

  return (
    <Card className="brand-card border-white/10 bg-[linear-gradient(180deg,rgba(8,23,46,0.92),rgba(4,12,24,0.84))]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <DatabaseZap className="h-5 w-5 text-primary" />
          {title}
        </CardTitle>
        <CardDescription className="text-slate-300">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-white">Projeto ativo</span>
            <Badge variant={connection.source === "runtime" ? "default" : "outline"} className="border-white/10">
              {connection.source === "runtime" ? "Conectado por token" : "Projeto embutido"}
            </Badge>
            {hasRuntimeSupabaseConnection() && <Badge variant="secondary">Override ativo</Badge>}
          </div>

          <div className="mt-3 space-y-1 text-sm text-slate-300">
            <p>
              <span className="font-medium text-white">Nome:</span> {connection.projectName}
            </p>
            <p>
              <span className="font-medium text-white">Ref:</span> {connection.projectRef}
            </p>
            <p className="break-all">
              <span className="font-medium text-white">URL:</span> {connection.url}
            </p>
          </div>

          {hasRuntimeSupabaseConnection() && (
            <Button variant="outline" size="sm" className="mt-4" onClick={handleDisconnect}>
              <Unplug className="mr-2 h-4 w-4" />
              Desconectar override
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="supabase-token" className="text-slate-200">
            Personal access token
          </Label>
          <Input
            id="supabase-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="sbp_..."
            className="h-12 rounded-2xl border-white/10 bg-white/5 text-slate-50 placeholder:text-slate-500"
          />
          <p className="text-xs text-slate-400">
            O token e usado apenas para descobrir projetos e chaves. Ele nao fica salvo na configuracao runtime do app.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={handleFetchProjects} disabled={loadingProjects || connecting}>
            {loadingProjects && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Buscar projetos
          </Button>

          {projects.length > 0 && (
            <Button type="button" variant="secondary" onClick={handleConnectProject} disabled={connecting}>
              {connecting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <PlugZap className="mr-2 h-4 w-4" />
              Conectar projeto
            </Button>
          )}
        </div>

        {projects.length > 0 && (
          <div className="space-y-2">
            <Label className="text-slate-200">Projeto descoberto com esse token</Label>
            <Select value={selectedProjectRef} onValueChange={setSelectedProjectRef}>
              <SelectTrigger className="h-12 rounded-2xl border-white/10 bg-white/5 text-slate-50">
                <SelectValue placeholder="Selecione um projeto" />
              </SelectTrigger>
              <SelectContent className="border-white/10 bg-[#08162b] text-slate-100">
                {projects.map((project) => (
                  <SelectItem key={project.ref} value={project.ref}>
                    {project.name} ({project.ref})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

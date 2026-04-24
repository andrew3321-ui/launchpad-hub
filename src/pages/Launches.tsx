import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLaunch } from "@/contexts/LaunchContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Rocket, Plus, RefreshCw, Loader2 } from "lucide-react";
import { LaunchDialog } from "@/components/launches/LaunchDialog";
import { useToast } from "@/hooks/use-toast";

interface AdvanceCycleResponse {
  file_name?: string;
  csv_content?: string;
  row_count?: number;
  previous_cycle_number?: number;
  current_cycle_number?: number;
}

function downloadCsv(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function Launches() {
  const { launches, activeLaunch, loading, refreshLaunches } = useLaunch();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [advancingId, setAdvancingId] = useState<string | null>(null);

  const toggleStatus = async (id: string, current: string) => {
    const newStatus = current === "active" ? "inactive" : "active";
    const { error } = await supabase.rpc("update_launch_metadata", {
      target_launch_id: id,
      next_status: newStatus,
    });

    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
      return;
    }

    await refreshLaunches();
  };

  const advanceCycle = async (launchId: string, launchName: string) => {
    setAdvancingId(launchId);

    const { data, error } = await supabase.rpc("advance_launch_cycle", {
      target_launch_id: launchId,
    });

    setAdvancingId(null);

    if (error || !data) {
      toast({
        title: "Erro ao mudar ciclo",
        description: error?.message || "O backend nao confirmou a virada de ciclo do expert.",
        variant: "destructive",
      });
      return;
    }

    const typedData = (data as AdvanceCycleResponse | null) ?? null;
    if (typedData?.file_name && typeof typedData.csv_content === "string") {
      downloadCsv(typedData.file_name, typedData.csv_content);
    }

    await refreshLaunches();

    toast({
      title: "Ciclo alterado",
      description:
        typedData?.row_count !== undefined
          ? `${typedData.row_count} lead(s) do expert ${launchName} foram arquivados no CSV do ciclo anterior.`
          : `O expert ${launchName} iniciou um novo ciclo.`,
    });
  };

  const handleSaved = async () => {
    setDialogOpen(false);
    setEditingId(null);
    await refreshLaunches();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Rocket className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Experts</h1>
            <p className="text-sm text-muted-foreground">
              Cadastre os experts da operacao e vire o ciclo mensal quando precisar arquivar os leads antigos em CSV.
            </p>
          </div>
        </div>
        <Button
          onClick={() => {
            setEditingId(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> Novo expert
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Ciclo atual</TableHead>
              <TableHead>Iniciado em</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="w-[260px]">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : launches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Nenhum expert criado.
                </TableCell>
              </TableRow>
            ) : (
              launches.map((launch) => {
                const isActive = activeLaunch?.id === launch.id;
                const isAdvancing = advancingId === launch.id;

                return (
                  <TableRow key={launch.id} className={isActive ? "bg-primary/5" : undefined}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{launch.name}</span>
                        {isActive && <Badge variant="outline">Ativo no painel</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {launch.slug}
                    </TableCell>
                    <TableCell>#{launch.current_cycle_number}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {launch.current_cycle_started_at
                        ? new Date(launch.current_cycle_started_at).toLocaleString("pt-BR")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={launch.status === "active" ? "default" : "secondary"}
                        className="cursor-pointer"
                        onClick={() => toggleStatus(launch.id, launch.status)}
                      >
                        {launch.status === "active" ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(launch.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingId(launch.id);
                            setDialogOpen(true);
                          }}
                        >
                          Editar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void advanceCycle(launch.id, launch.name)}
                          disabled={isAdvancing}
                        >
                          {isAdvancing ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                          )}
                          Mudar ciclo
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <LaunchDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingId(null);
        }}
        launchId={editingId}
        onSaved={handleSaved}
      />
    </div>
  );
}

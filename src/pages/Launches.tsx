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
import { Rocket, Plus } from "lucide-react";
import { LaunchDialog } from "@/components/launches/LaunchDialog";
import { useToast } from "@/hooks/use-toast";

export default function Launches() {
  const { launches, loading, refreshLaunches } = useLaunch();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
          <h1 className="text-2xl font-bold">Lancamentos</h1>
        </div>
        <Button
          onClick={() => {
            setEditingId(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> Novo lancamento
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="w-[100px]">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : launches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Nenhum lancamento criado.
                </TableCell>
              </TableRow>
            ) : (
              launches.map((launch) => (
                <TableRow key={launch.id}>
                  <TableCell className="font-medium">{launch.name}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {launch.slug}
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
                  </TableCell>
                </TableRow>
              ))
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

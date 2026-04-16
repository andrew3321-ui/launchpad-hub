import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useLaunch } from "@/contexts/LaunchContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Rocket, Plus } from "lucide-react";
import { LaunchDialog } from "@/components/launches/LaunchDialog";
import { useToast } from "@/hooks/use-toast";

interface LaunchRow {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  created_at: string;
}

export default function Launches() {
  const { user } = useAuth();
  const { refreshLaunches } = useLaunch();
  const { toast } = useToast();
  const [rows, setRows] = useState<LaunchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchRows = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("launches")
      .select("id, name, slug, status, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        title: "Erro ao carregar lan?amentos",
        description: error.message,
        variant: "destructive",
      });
      setRows([]);
      setLoading(false);
      return;
    }

    if (data) setRows(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchRows();
  }, []);

  const toggleStatus = async (id: string, current: string) => {
    const newStatus = current === "active" ? "inactive" : "active";
    const { error } = await supabase.from("launches").update({ status: newStatus }).eq("id", id);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      await fetchRows();
      await refreshLaunches();
    }
  };

  const handleSaved = async () => {
    setDialogOpen(false);
    setEditingId(null);
    await fetchRows();
    await refreshLaunches();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Rocket className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Lançamentos</h1>
        </div>
        <Button onClick={() => { setEditingId(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Novo lançamento
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
              <TableHead className="w-[100px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum lançamento criado.</TableCell></TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-muted-foreground font-mono text-sm">{r.slug}</TableCell>
                  <TableCell>
                    <Badge
                      variant={r.status === "active" ? "default" : "secondary"}
                      className="cursor-pointer"
                      onClick={() => toggleStatus(r.id, r.status)}
                    >
                      {r.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => { setEditingId(r.id); setDialogOpen(true); }}>
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
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingId(null); }}
        launchId={editingId}
        onSaved={handleSaved}
      />
    </div>
  );
}

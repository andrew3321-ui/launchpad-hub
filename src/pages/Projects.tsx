import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useProject } from "@/contexts/ProjectContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { FolderOpen, Plus } from "lucide-react";
import { ProjectDialog } from "@/components/projects/ProjectDialog";
import { useToast } from "@/hooks/use-toast";
import { withTimeout } from "@/lib/supabaseTimeout";

interface ProjectRow {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  created_at: string;
  launch_count: number;
}

export default function Projects() {
  const { refreshProjects } = useProject();
  const { toast } = useToast();
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchRows = async () => {
    setLoading(true);
    try {
      const { data, error } = await withTimeout(
        supabase.from("projects").select("id, name, slug, status, created_at").order("created_at", { ascending: false }),
        10000, "Fetch projects"
      );

      if (error) {
        console.error("Error fetching projects:", error);
        toast({ title: "Erro ao carregar projetos", description: error.message, variant: "destructive" });
        return;
      }

      if (data) {
        // Fetch launch counts separately — don't block main list
        let counts: Record<string, number> = {};
        try {
          const { data: launches } = await withTimeout(
            supabase.from("launches").select("project_id"),
            10000, "Fetch launch counts"
          );
          launches?.forEach((l) => {
            if (l.project_id) {
              counts[l.project_id] = (counts[l.project_id] || 0) + 1;
            }
          });
        } catch {
          console.warn("Could not fetch launch counts");
        }

        setRows(data.map((p) => ({ ...p, launch_count: counts[p.id] || 0 })));
      }
    } catch (err) {
      console.error("Error in fetchRows:", err);
      toast({ title: "Erro ao carregar", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, []);

  const toggleStatus = async (id: string, current: string) => {
    const newStatus = current === "active" ? "inactive" : "active";
    try {
      const { error } = await supabase.from("projects").update({ status: newStatus }).eq("id", id);
      if (error) {
        toast({ title: "Erro", description: error.message, variant: "destructive" });
      } else {
        await fetchRows();
        await refreshProjects();
      }
    } catch (err) {
      console.error("Error toggling status:", err);
    }
  };

  const handleSaved = async () => {
    setDialogOpen(false);
    setEditingId(null);
    await fetchRows();
    await refreshProjects();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderOpen className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Projetos</h1>
        </div>
        <Button onClick={() => { setEditingId(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Novo projeto
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Lançamentos</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="w-[100px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Carregando...</TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhum projeto criado.</TableCell></TableRow>
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
                  <TableCell className="text-muted-foreground">{r.launch_count}</TableCell>
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

      <ProjectDialog
        open={dialogOpen}
        onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingId(null); }}
        projectId={editingId}
        onSaved={handleSaved}
      />
    </div>
  );
}

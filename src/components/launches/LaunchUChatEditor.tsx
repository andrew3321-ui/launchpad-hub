import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface LaunchWorkspace {
  workspace_id: string;
  workspace_name: string;
  max_subscribers: number;
  current_count: number;
}

interface Props {
  projectId: string;
  workspaces: LaunchWorkspace[];
  onChange: (workspaces: LaunchWorkspace[]) => void;
}

interface ProjectWorkspace {
  id: string;
  workspace_name: string;
}

export function LaunchUChatEditor({ projectId, workspaces, onChange }: Props) {
  const [available, setAvailable] = useState<ProjectWorkspace[]>([]);

  useEffect(() => {
    if (!projectId) return;
    supabase
      .from("uchat_workspaces")
      .select("id, workspace_name")
      .eq("project_id", projectId)
      .order("created_at")
      .then(({ data }) => {
        if (data) setAvailable(data);
      });
  }, [projectId]);

  const selectedIds = new Set(workspaces.map((w) => w.workspace_id));

  const toggleWorkspace = (ws: ProjectWorkspace) => {
    if (selectedIds.has(ws.id)) {
      onChange(workspaces.filter((w) => w.workspace_id !== ws.id));
    } else {
      onChange([...workspaces, {
        workspace_id: ws.id,
        workspace_name: ws.workspace_name,
        max_subscribers: 1000,
        current_count: 0,
      }]);
    }
  };

  const updateMax = (workspaceId: string, val: number) => {
    onChange(workspaces.map((w) =>
      w.workspace_id === workspaceId ? { ...w, max_subscribers: val } : w
    ));
  };

  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum workspace cadastrado no projeto. Cadastre workspaces na aba UChat do projeto primeiro.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Selecione quais workspaces do projeto usar neste lançamento e defina os limites.
      </p>
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Usar</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Máx. subs</TableHead>
              <TableHead>Atual</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {available.map((ws) => {
              const selected = workspaces.find((w) => w.workspace_id === ws.id);
              return (
                <TableRow key={ws.id}>
                  <TableCell>
                    <Checkbox
                      checked={!!selected}
                      onCheckedChange={() => toggleWorkspace(ws)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{ws.workspace_name}</TableCell>
                  <TableCell>
                    {selected ? (
                      <Input
                        type="number"
                        value={selected.max_subscribers}
                        onChange={(e) => updateMax(ws.id, parseInt(e.target.value) || 0)}
                        className="w-24"
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-center">
                    {selected ? selected.current_count : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

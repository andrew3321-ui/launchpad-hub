import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface UChatWorkspace {
  id?: string;
  workspace_name: string;
  workspace_id: string;
  bot_id: string;
  api_token: string;
  max_subscribers: number;
  current_count: number;
}

interface Props {
  workspaces: UChatWorkspace[];
  onChange: (workspaces: UChatWorkspace[]) => void;
}

export function UChatWorkspacesEditor({ workspaces, onChange }: Props) {
  const addWorkspace = () => {
    onChange([
      ...workspaces,
      { workspace_name: "", workspace_id: "", bot_id: "", api_token: "", max_subscribers: 1000, current_count: 0 },
    ]);
  };

  const update = (index: number, field: keyof UChatWorkspace, value: string | number) => {
    const updated = [...workspaces];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const remove = (index: number) => {
    onChange(workspaces.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {workspaces.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome (opcional)</TableHead>
                <TableHead>Workspace ID</TableHead>
                <TableHead>API Token</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((workspace, index) => (
                <TableRow key={workspace.id || index}>
                  <TableCell>
                    <Input
                      value={workspace.workspace_name}
                      onChange={(event) => update(index, "workspace_name", event.target.value)}
                      placeholder="Ex: Libras Principal"
                      className="min-w-[170px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={workspace.workspace_id}
                      onChange={(event) => update(index, "workspace_id", event.target.value)}
                      placeholder="ID do workspace"
                      className="min-w-[150px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="password"
                      value={workspace.api_token}
                      onChange={(event) => update(index, "api_token", event.target.value)}
                      placeholder="Cole o token da API"
                      className="min-w-[230px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Para importar do UChat, usamos somente o <span className="font-medium text-foreground">Workspace ID</span> e o{" "}
        <span className="font-medium text-foreground">API Token</span>. O restante dos campos internos e preenchido automaticamente.
      </p>

      <Button type="button" variant="outline" size="sm" onClick={addWorkspace}>
        <Plus className="mr-1 h-4 w-4" /> Adicionar workspace
      </Button>
    </div>
  );
}

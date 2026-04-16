import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface UChatWorkspaceDraft {
  id?: string;
  workspace_name: string;
  workspace_id: string;
  api_token: string;
  welcome_subflow_ns: string;
  default_tag_name: string;
}

interface Props {
  workspaces: UChatWorkspaceDraft[];
  onChange: (workspaces: UChatWorkspaceDraft[]) => void;
}

const emptyWorkspace: UChatWorkspaceDraft = {
  workspace_name: "",
  workspace_id: "",
  api_token: "",
  welcome_subflow_ns: "",
  default_tag_name: "",
};

export function UChatWorkspacesEditor({ workspaces, onChange }: Props) {
  const addWorkspace = () => {
    onChange([...workspaces, { ...emptyWorkspace }]);
  };

  const update = (
    index: number,
    field: keyof UChatWorkspaceDraft,
    value: string,
  ) => {
    const updated = [...workspaces];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const remove = (index: number) => {
    onChange(workspaces.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div className="space-y-3">
      {workspaces.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Workspace ID</TableHead>
                <TableHead>API Token</TableHead>
                <TableHead>Subflow de boas-vindas</TableHead>
                <TableHead>Tag padrao</TableHead>
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
                      placeholder="Ex: Libras principal"
                      className="min-w-[170px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={workspace.workspace_id}
                      onChange={(event) => update(index, "workspace_id", event.target.value)}
                      placeholder="Workspace ID"
                      className="min-w-[150px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="password"
                      value={workspace.api_token}
                      onChange={(event) => update(index, "api_token", event.target.value)}
                      placeholder="API token"
                      className="min-w-[210px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={workspace.welcome_subflow_ns}
                      onChange={(event) => update(index, "welcome_subflow_ns", event.target.value)}
                      placeholder="subflow_ns"
                      className="min-w-[170px]"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={workspace.default_tag_name}
                      onChange={(event) => update(index, "default_tag_name", event.target.value)}
                      placeholder="tag padrao"
                      className="min-w-[160px]"
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
        O Launch Hub usa o primeiro workspace valido como destino padrao para mandar de volta
        o contato tratado ao UChat. Configure o subflow e/ou a tag que devem ser acionados.
      </p>

      <Button type="button" variant="outline" size="sm" onClick={addWorkspace}>
        <Plus className="mr-1 h-4 w-4" /> Adicionar workspace
      </Button>
    </div>
  );
}

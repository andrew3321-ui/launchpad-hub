import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

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
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Workspace ID</TableHead>
                <TableHead>Bot ID</TableHead>
                <TableHead>API Token</TableHead>
                <TableHead>Máx. subs</TableHead>
                <TableHead>Atual</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.map((w, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Input value={w.workspace_name} onChange={(e) => update(i, "workspace_name", e.target.value)} placeholder="Nome" className="min-w-[120px]" />
                  </TableCell>
                  <TableCell>
                    <Input value={w.workspace_id} onChange={(e) => update(i, "workspace_id", e.target.value)} placeholder="ID" className="min-w-[100px]" />
                  </TableCell>
                  <TableCell>
                    <Input value={w.bot_id} onChange={(e) => update(i, "bot_id", e.target.value)} placeholder="Bot ID" className="min-w-[100px]" />
                  </TableCell>
                  <TableCell>
                    <Input type="password" value={w.api_token} onChange={(e) => update(i, "api_token", e.target.value)} placeholder="Token" className="min-w-[100px]" />
                  </TableCell>
                  <TableCell>
                    <Input type="number" value={w.max_subscribers} onChange={(e) => update(i, "max_subscribers", parseInt(e.target.value) || 0)} className="w-20" />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-center">{w.current_count}</TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Button type="button" variant="outline" size="sm" onClick={addWorkspace}>
        <Plus className="h-4 w-4 mr-1" /> Adicionar workspace
      </Button>
    </div>
  );
}

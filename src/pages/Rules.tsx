import { GitBranch } from "lucide-react";

export default function Rules() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <GitBranch className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Regras</h1>
      </div>
      <p className="text-muted-foreground">Monte suas regras de automação aqui.</p>
    </div>
  );
}

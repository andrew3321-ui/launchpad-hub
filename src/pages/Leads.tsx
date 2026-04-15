import { Users } from "lucide-react";

export default function Leads() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Leads</h1>
      </div>
      <p className="text-muted-foreground">Visualize e gerencie seus leads aqui.</p>
    </div>
  );
}

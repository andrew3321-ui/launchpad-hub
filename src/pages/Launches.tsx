import { Rocket } from "lucide-react";

export default function Launches() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Rocket className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Lançamentos</h1>
      </div>
      <p className="text-muted-foreground">Gerencie seus lançamentos aqui.</p>
    </div>
  );
}

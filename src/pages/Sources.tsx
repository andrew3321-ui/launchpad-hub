import { Radio } from "lucide-react";

export default function Sources() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Radio className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Fontes</h1>
      </div>
      <p className="text-muted-foreground">Configure suas fontes de leads aqui.</p>
    </div>
  );
}

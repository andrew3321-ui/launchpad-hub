import { ListOrdered } from "lucide-react";

export default function Queue() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ListOrdered className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Fila</h1>
      </div>
      <p className="text-muted-foreground">Acompanhe a fila de processamento aqui.</p>
    </div>
  );
}

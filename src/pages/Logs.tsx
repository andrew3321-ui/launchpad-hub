import { FileText } from "lucide-react";

export default function Logs() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Logs</h1>
      </div>
      <p className="text-muted-foreground">Veja os logs de atividade aqui.</p>
    </div>
  );
}

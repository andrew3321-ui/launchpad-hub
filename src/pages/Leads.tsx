import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLaunch } from "@/contexts/LaunchContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Users } from "lucide-react";

interface LeadRow {
  id: string;
  primary_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  merged_from_count: number;
  last_source: string | null;
  status: string;
  updated_at: string;
}

export default function Leads() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();

  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!activeLaunch) {
        setRows([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase
        .from("lead_contacts")
        .select("id, primary_name, primary_email, primary_phone, merged_from_count, last_source, status, updated_at")
        .eq("launch_id", activeLaunch.id)
        .order("updated_at", { ascending: false })
        .limit(100);

      if (error) {
        toast({ title: "Erro ao carregar leads", description: error.message, variant: "destructive" });
        setLoading(false);
        return;
      }

      setRows((data || []) as LeadRow[]);
      setLoading(false);
    };

    load();
  }, [activeLaunch, toast]);

  if (!activeLaunch) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Leads</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Selecione um lancamento</CardTitle>
            <CardDescription>
              Escolha um lancamento na barra lateral para visualizar a base tratada e deduplicada.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Base canonica do lancamento <span className="font-medium text-foreground">{activeLaunch.name}</span>, consolidada para revisao, automacao e futuras sincronizacoes.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Contatos tratados</CardTitle>
          <CardDescription>
            Cada linha representa um contato final depois do processo de normalizacao e merge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-sm text-muted-foreground">
              Nenhum lead processado ainda. Assim que o backend ingerir contatos, a base tratada aparecera aqui.
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Telefone</TableHead>
                    <TableHead>Ultima fonte</TableHead>
                    <TableHead>Mesclas</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Atualizado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.primary_name || "-"}</TableCell>
                      <TableCell>{row.primary_email || "-"}</TableCell>
                      <TableCell>{row.primary_phone || "-"}</TableCell>
                      <TableCell className="capitalize">{row.last_source || "-"}</TableCell>
                      <TableCell>{row.merged_from_count}</TableCell>
                      <TableCell>
                        <Badge variant={row.status === "active" ? "default" : "secondary"}>{row.status}</Badge>
                      </TableCell>
                      <TableCell>{new Date(row.updated_at).toLocaleString("pt-BR")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

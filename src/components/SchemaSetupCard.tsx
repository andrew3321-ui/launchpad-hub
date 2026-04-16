import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Database, Loader2, RefreshCcw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { buildLovableBootstrapPrompt, checkSchemaHealth, type SchemaIssue, type SchemaStatus } from "@/lib/schemaHealth";
import bootstrapSql from "../../supabase/bootstrap.sql?raw";

interface Props {
  title?: string;
  description?: string;
}

function formatIssueLabel(issue: SchemaIssue) {
  if (issue.kind === "column" && issue.column) {
    return `${issue.table}.${issue.column}`;
  }

  return issue.table;
}

export function SchemaSetupCard({
  title = "Schema do backend",
  description = "Valide se o projeto Supabase atual ja tem todas as tabelas e colunas esperadas pelo app.",
}: Props) {
  const { connection } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<SchemaStatus | null>(null);
  const [checking, setChecking] = useState(true);

  const validateSchema = useCallback(async () => {
    setChecking(true);

    try {
      const nextStatus = await checkSchemaHealth(supabase);
      setStatus(nextStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao validar o schema atual.";
      toast({ title: "Erro ao validar schema", description: message, variant: "destructive" });
      setStatus({
        ready: false,
        issues: [
          {
            kind: "unknown",
            table: "schema_check",
            description: message,
          },
        ],
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setChecking(false);
    }
  }, [toast]);

  useEffect(() => {
    validateSchema();
  }, [validateSchema, connection.projectRef]);

  const bootstrapPrompt = useMemo(() => buildLovableBootstrapPrompt(status?.issues ?? []), [status?.issues]);

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copiado`, description: "Você já pode colar isso no Lovable ou guardar para o setup." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível copiar para a área de transferência.";
      toast({ title: "Falha ao copiar", description: message, variant: "destructive" });
    }
  };

  return (
    <Card className="brand-card border-white/10 bg-[linear-gradient(180deg,rgba(8,23,46,0.92),rgba(4,12,24,0.84))]">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Database className="h-5 w-5 text-primary" />
            {title}
          </CardTitle>
          {checking ? (
            <Badge variant="secondary">Validando</Badge>
          ) : status?.ready ? (
            <Badge className="gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Pronto
            </Badge>
          ) : (
            <Badge variant="destructive">Pendente</Badge>
          )}
        </div>
        <CardDescription className="text-slate-300">{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-[1.35rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
          <p>
            <span className="font-medium text-white">Projeto validado:</span> {connection.projectName} ({connection.projectRef})
          </p>
          <p className="mt-1">
            O app consegue trocar de projeto em runtime, mas criação de tabela/coluna não pode acontecer pelo front com chave pública.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={validateSchema} disabled={checking}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Revalidar
          </Button>
          {!status?.ready && !checking && (
            <>
              <Button type="button" variant="outline" onClick={() => copyToClipboard(bootstrapPrompt, "Prompt do Lovable")}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar prompt do Lovable
              </Button>
              <Button type="button" variant="outline" onClick={() => copyToClipboard(bootstrapSql, "SQL bootstrap")}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar SQL bootstrap
              </Button>
            </>
          )}
        </div>

        {checking ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Validando tabelas e colunas obrigatorias...
          </div>
        ) : status?.ready ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Schema pronto</AlertTitle>
            <AlertDescription>
              Esse projeto já tem a estrutura mínima esperada para autenticação, fontes, regras, leads e logs.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
               <AlertTitle>Schema incompleto no backend atual</AlertTitle>
              <AlertDescription>
                O app detectou itens ausentes no Supabase conectado. Isso costuma acontecer quando o projeto foi aberto pela primeira vez no Lovable sem rodar as migrations.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <p className="text-sm font-medium">Itens ausentes ou não validados</p>
              <div className="flex flex-wrap gap-2">
                {(status?.issues ?? []).map((issue) => (
                  <Badge key={`${issue.table}-${issue.column ?? "table"}`} variant="outline">
                    {formatIssueLabel(issue)}
                  </Badge>
                ))}
              </div>
              <div className="space-y-1 text-sm text-slate-300">
                {(status?.issues ?? []).map((issue) => (
                  <p key={`${issue.table}-${issue.column ?? issue.description}`}>{issue.description}</p>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium text-white">Bootstrap SQL consolidado</p>
              <Textarea
                className="min-h-48 rounded-[1.4rem] border-white/10 bg-[#08162b]/90 font-mono text-xs text-slate-100"
                value={bootstrapSql}
                readOnly
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

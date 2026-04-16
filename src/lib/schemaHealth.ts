import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface SchemaIssue {
  kind: "table" | "column" | "unknown";
  table: string;
  column: string;
  description: string;
}

export interface SchemaStatus {
  ready: boolean;
  issues: SchemaIssue[];
  checkedAt: string;
}

interface SchemaProbe {
  table: keyof Database["public"]["Tables"];
  select: string;
  kind: "table" | "column";
  column: string;
  description: string;
}

const schemaProbes: SchemaProbe[] = [
  { table: "profiles", select: "id", kind: "table", description: "Tabela de perfis de autenticação" },
  { table: "launches", select: "id", kind: "table", description: "Tabela principal de lançamentos" },
  {
    table: "launches",
    select: "manychat_api_url",
    kind: "column",
    column: "manychat_api_url",
    description: "Colunas de conexão do ManyChat em launches",
  },
  { table: "uchat_workspaces", select: "id", kind: "table", description: "Tabela de workspaces do UChat" },
  {
    table: "launch_dedupe_settings",
    select: "launch_id",
    kind: "table",
    description: "Tabela de regras de deduplicação por lançamento",
  },
  { table: "lead_contacts", select: "id", kind: "table", description: "Tabela canúnica de contatos tratados" },
  {
    table: "lead_contact_identities",
    select: "id",
    kind: "table",
    description: "Tabela de identidades externas por plataforma",
  },
  {
    table: "inbound_contact_events",
    select: "id",
    kind: "table",
    description: "Tabela de eventos recebidos via integração",
  },
  {
    table: "contact_processing_logs",
    select: "id",
    kind: "table",
    description: "Tabela de logs operacionais do processamento",
  },
  {
    table: "platform_sync_runs",
    select: "id",
    kind: "table",
    description: "Tabela de rodadas de sincronização com plataformas externas",
  },
];

function describeMissingProbe(probe: SchemaProbe): SchemaIssue {
  return {
    kind: probe.kind,
    table: probe.table,
    column: probe.column,
    description: probe.description,
  };
}

function isMissingTable(error: PostgrestError) {
  const message = `${error.code} ${error.message} ${error.details  ""}`.toLowerCase();
  return (
    error.code === "42P01" ||
    message.includes("could not find the table") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

function isMissingColumn(error: PostgrestError) {
  const message = `${error.code} ${error.message} ${error.details  ""}`.toLowerCase();
  return error.code === "42703" || (message.includes("could not find the") && message.includes("column"));
}

function isPermissionDenied(error: PostgrestError) {
  const message = `${error.code} ${error.message} ${error.details  ""}`.toLowerCase();
  return error.code === "42501" || error.code === "PGRST301" || message.includes("permission denied");
}

function classifyProbeError(probe: SchemaProbe, error: PostgrestError): SchemaIssue | null {
  if (isMissingTable(error)) {
    return {
      ...describeMissingProbe(probe),
      kind: "table",
      description: `Tabela ausente: ${probe.table}`,
    };
  }

  if (probe.kind === "column" && isMissingColumn(error)) {
    return {
      ...describeMissingProbe(probe),
      description: `Coluna ausente: ${probe.table}.${probe.column}`,
    };
  }

  if (error.code === "PGRST116" || isPermissionDenied(error)) {
    return null;
  }

  return {
    kind: "unknown",
    table: probe.table,
    column: probe.column,
    description: `Não foi possível validar ${probe.table}${probe.column  `.${probe.column}` : ""}: ${error.message}`,
  };
}

export async function checkSchemaHealth(client: SupabaseClient<Database>): Promise<SchemaStatus> {
  const issues: SchemaIssue[] = [];

  for (const probe of schemaProbes) {
    const { error } = await client.from(probe.table).select(probe.select).limit(1);
    if (!error) continue;

    const issue = classifyProbeError(probe, error);
    if (issue) {
      issues.push(issue);
    }
  }

  return {
    ready: issues.length === 0,
    issues,
    checkedAt: new Date().toISOString(),
  };
}

export function buildLovableBootstrapPrompt(issues: SchemaIssue[]) {
  const missingItems = issues
    .map((issue) => (issue.kind === "column" && issue.column  `${issue.table}.${issue.column}` : issue.table))
    .join(", ");

  return [
    "Conecte este projeto ao backend Supabase atual do Lovable e aplique o schema do app.",
    "Use o arquivo supabase/bootstrap.sql como fonte principal ou execute os arquivos de supabase/migrations em ordem cronologica.",
    "Garanta que as estruturas abaixo existam antes de continuar:",
    missingItems || "profiles, launches, uchat_workspaces, launch_dedupe_settings, lead_contacts, lead_contact_identities, inbound_contact_events, contact_processing_logs, platform_sync_runs",
    "Depois publique ou atualize as edge functions process-contact-event, sync-platform-contacts e supabase-project-connector.",
    "Depois confirme que o frontend pode ler launches, launch_dedupe_settings e contact_processing_logs sem erro de schema ausente.",
  ].join("\n");
}

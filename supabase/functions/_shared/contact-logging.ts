// deno-lint-ignore-file no-explicit-any
type AnySupabaseClient = any;
type JsonRecord = Record<string, unknown>;

type LogLevel = "info" | "warning" | "error" | "success";

export interface ContactLogRow {
  launch_id: string;
  event_id?: string | null;
  contact_id?: string | null;
  source: string;
  level: LogLevel;
  code: string;
  title: string;
  message: string;
  details?: JsonRecord;
  cycle_number?: number | null;
}

const redactedKeyPattern = /(api[_-]?key|token|secret|password|authorization|private[_-]?key|refresh[_-]?token)/i;
const maxStringLength = 500;
const maxObjectKeys = 18;
const maxArrayItems = 8;
const maxDepth = 3;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncateString(value: string) {
  return value.length > maxStringLength ? `${value.slice(0, maxStringLength)}...` : value;
}

function summarizeValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;

  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    const items = value.slice(0, maxArrayItems).map((item) => summarizeValue(item, depth + 1));
    if (value.length > maxArrayItems) {
      items.push({ truncatedItems: value.length - maxArrayItems });
    }
    return items;
  }

  if (isRecord(value)) {
    if (depth >= maxDepth) {
      return { type: "object", truncated: true };
    }

    const output: JsonRecord = {};
    const entries = Object.entries(value);

    for (const [key, nestedValue] of entries.slice(0, maxObjectKeys)) {
      output[key] = redactedKeyPattern.test(key) ? "[redacted]" : summarizeValue(nestedValue, depth + 1);
    }

    if (entries.length > maxObjectKeys) {
      output.truncatedKeys = entries.length - maxObjectKeys;
    }

    return output;
  }

  return String(value);
}

function sanitizeDetails(details: JsonRecord = {}) {
  return summarizeValue(details) as JsonRecord;
}

function technicalLogFrom(row: ContactLogRow, operationalLogId?: string | null) {
  return {
    operational_log_id: operationalLogId ?? null,
    launch_id: row.launch_id,
    event_id: row.event_id ?? null,
    contact_id: row.contact_id ?? null,
    source: row.source,
    level: row.level,
    code: row.code,
    title: row.title,
    message: row.message,
    details: row.details ?? {},
  } as Record<string, unknown>;
}

function operationalLogFrom(row: ContactLogRow) {
  const output: Record<string, unknown> = {
    launch_id: row.launch_id,
    event_id: row.event_id ?? null,
    contact_id: row.contact_id ?? null,
    source: row.source,
    level: row.level,
    code: row.code,
    title: row.title,
    message: row.message,
    details: sanitizeDetails(row.details ?? {}),
  };

  if (row.cycle_number !== undefined && row.cycle_number !== null) {
    output.cycle_number = row.cycle_number;
  }

  return output;
}

async function insertTechnicalLogs(supabase: AnySupabaseClient, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return;

  const { error } = await supabase.from("contact_technical_logs").insert(rows);
  if (error) {
    // Technical logs must never block webhook processing or user-visible logs.
    console.warn("Failed to insert contact_technical_logs", error.message);
  }
}

export async function insertContactLog(supabase: AnySupabaseClient, row: ContactLogRow) {
  const { error } = await supabase
    .from("contact_processing_logs")
    .insert(operationalLogFrom(row));

  if (error) throw error;

  await insertTechnicalLogs(supabase, [technicalLogFrom(row)]);
}

export async function insertContactLogs(supabase: AnySupabaseClient, rows: ContactLogRow[]) {
  if (rows.length === 0) return;

  const { error } = await supabase
    .from("contact_processing_logs")
    .insert(rows.map(operationalLogFrom));

  if (error) throw error;

  await insertTechnicalLogs(supabase, rows.map((row) => technicalLogFrom(row)));
}

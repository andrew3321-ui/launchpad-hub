// deno-lint-ignore-file no-explicit-any
type AnySupabaseClient = any;
type JsonRecord = Record<string, unknown>;

type LogLevel = "info" | "warning" | "error" | "success";

interface EdgeRuntimeLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface DiscordAlertSettings {
  discordEnabled: boolean;
  discordWebhookUrl: string | null;
  alertLevels: string[];
  alertSources: string[];
  minRepeatIntervalSeconds: number;
}

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
const discordFieldLimit = 900;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getEdgeRuntime() {
  return (globalThis as typeof globalThis & { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime ?? null;
}

function scheduleBackgroundTask(promise: Promise<unknown>) {
  const runtime = getEdgeRuntime();

  if (runtime) {
    runtime.waitUntil(promise);
    return;
  }

  void promise.catch((error) => {
    console.warn("Background contact log task failed", error instanceof Error ? error.message : String(error));
  });
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

function asStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return values.length > 0 ? values : fallback;
}

function truncateForDiscord(value: string, maxLength = discordFieldLimit) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function maskSensitiveText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => {
      const [local, domain] = email.split("@");
      if (!local || !domain) return "[email]";
      return `${local.slice(0, 2)}***@${domain}`;
    })
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (phone) => {
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 8) return phone;
      return `***${digits.slice(-4)}`;
    });
}

function sanitizeForDiscord(value: unknown): unknown {
  if (typeof value === "string") return maskSensitiveText(truncateString(value));
  if (Array.isArray(value)) return value.slice(0, maxArrayItems).map(sanitizeForDiscord);

  if (isRecord(value)) {
    const output: JsonRecord = {};
    const entries = Object.entries(value);

    for (const [key, nestedValue] of entries.slice(0, maxObjectKeys)) {
      output[key] = redactedKeyPattern.test(key) ? "[redacted]" : sanitizeForDiscord(nestedValue);
    }

    if (entries.length > maxObjectKeys) {
      output.truncatedKeys = entries.length - maxObjectKeys;
    }

    return output;
  }

  return value;
}

function formatDiscordJson(value: unknown) {
  try {
    return truncateForDiscord(JSON.stringify(sanitizeForDiscord(value), null, 2));
  } catch {
    return truncateForDiscord(maskSensitiveText(String(value)));
  }
}

async function loadDiscordAlertSettings(supabase: AnySupabaseClient): Promise<DiscordAlertSettings | null> {
  const { data, error } = await supabase
    .from("platform_alert_settings")
    .select("discord_enabled, discord_webhook_url, alert_levels, alert_sources, min_repeat_interval_seconds")
    .eq("id", "global")
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.warn("Failed to load Discord alert settings", error.message);
    }
    return null;
  }

  return {
    discordEnabled: data.discord_enabled === true,
    discordWebhookUrl: typeof data.discord_webhook_url === "string" ? data.discord_webhook_url : null,
    alertLevels: asStringArray(data.alert_levels, ["error"]),
    alertSources: asStringArray(data.alert_sources, [
      "activecampaign",
      "manychat",
      "typebot",
      "tally",
      "sendflow",
      "uchat",
    ]),
    minRepeatIntervalSeconds:
      typeof data.min_repeat_interval_seconds === "number" ? data.min_repeat_interval_seconds : 300,
  };
}

async function getLaunchLabel(supabase: AnySupabaseClient, launchId: string) {
  const { data, error } = await supabase
    .from("launches")
    .select("name, slug")
    .eq("id", launchId)
    .maybeSingle();

  if (error || !data) return launchId;
  const name = typeof data.name === "string" ? data.name : null;
  const slug = typeof data.slug === "string" ? data.slug : null;
  return name ? `${name}${slug ? ` (${slug})` : ""}` : launchId;
}

async function shouldSkipDiscordAlert(
  supabase: AnySupabaseClient,
  dedupeKey: string,
  minRepeatIntervalSeconds: number,
) {
  if (minRepeatIntervalSeconds <= 0) return false;

  const since = new Date(Date.now() - minRepeatIntervalSeconds * 1000).toISOString();
  const { data, error } = await supabase
    .from("alert_delivery_logs")
    .select("id")
    .eq("channel", "discord")
    .eq("dedupe_key", dedupeKey)
    .gte("created_at", since)
    .limit(1);

  if (error) {
    console.warn("Failed to check Discord alert dedupe", error.message);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

async function recordDiscordAlertDelivery(
  supabase: AnySupabaseClient,
  row: ContactLogRow,
  dedupeKey: string,
  status: "success" | "failed" | "skipped",
  errorMessage?: string,
) {
  const { error } = await supabase.from("alert_delivery_logs").insert({
    channel: "discord",
    launch_id: row.launch_id,
    source: row.source,
    level: row.level,
    code: row.code,
    dedupe_key: dedupeKey,
    status,
    error_message: errorMessage ? truncateString(errorMessage) : null,
  });

  if (error) {
    console.warn("Failed to record Discord alert delivery", error.message);
  }
}

async function sendDiscordAlertForLog(
  supabase: AnySupabaseClient,
  row: ContactLogRow,
  settings: DiscordAlertSettings,
) {
  if (!settings.alertLevels.includes(row.level)) return;
  if (!settings.alertSources.includes(row.source)) return;

  const dedupeKey = `${row.launch_id}:${row.source}:${row.level}:${row.code}`;
  if (await shouldSkipDiscordAlert(supabase, dedupeKey, settings.minRepeatIntervalSeconds)) {
    return;
  }

  const launchLabel = await getLaunchLabel(supabase, row.launch_id);
  const detailsText = formatDiscordJson(row.details ?? {});
  const fields = [
    { name: "Expert", value: truncateForDiscord(launchLabel, 256), inline: false },
    { name: "Fonte", value: truncateForDiscord(row.source, 128), inline: true },
    { name: "Codigo", value: truncateForDiscord(row.code, 128), inline: true },
    { name: "Contato", value: row.contact_id ? truncateForDiscord(row.contact_id, 128) : "Sem contato", inline: true },
  ];

  if (detailsText && detailsText !== "{}") {
    fields.push({ name: "Detalhes", value: `\`\`\`json\n${detailsText}\n\`\`\``, inline: false });
  }

  try {
    const response = await fetch(settings.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Launch Hub",
        embeds: [
          {
            title: truncateForDiscord(`[${row.level.toUpperCase()}] ${row.title}`, 256),
            description: truncateForDiscord(row.message, 800),
            color: row.level === "error" ? 0xef4444 : 0xf59e0b,
            fields,
            footer: { text: "Launch Hub - alerta operacional" },
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });

    if (!response.ok) {
      const rawText = await response.text();
      throw new Error(`Discord HTTP ${response.status}: ${rawText}`);
    }

    await recordDiscordAlertDelivery(supabase, row, dedupeKey, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Failed to send Discord alert", message);
    await recordDiscordAlertDelivery(supabase, row, dedupeKey, "failed", message);
  }
}

function notifyDiscordForOperationalRows(supabase: AnySupabaseClient, rows: Array<Record<string, unknown>>) {
  const errorRows = rows
    .filter((row) => row.level === "error" && typeof row.launch_id === "string")
    .map((row): ContactLogRow => ({
      launch_id: row.launch_id as string,
      contact_id: typeof row.contact_id === "string" ? row.contact_id : null,
      event_id: typeof row.event_id === "string" ? row.event_id : null,
      source: typeof row.source === "string" ? row.source : "unknown",
      level: "error",
      code: typeof row.code === "string" ? row.code : "UNKNOWN_ERROR",
      title: typeof row.title === "string" ? row.title : "Erro no Launch Hub",
      message: typeof row.message === "string" ? row.message : "Um erro operacional foi registrado.",
      details: isRecord(row.details) ? row.details : {},
    }));

  if (errorRows.length === 0) return;

  scheduleBackgroundTask(
    (async () => {
      const settings = await loadDiscordAlertSettings(supabase);
      if (!settings?.discordEnabled || !settings.discordWebhookUrl) return;

      await Promise.all(errorRows.map((row) => sendDiscordAlertForLog(supabase, row, settings)));
    })(),
  );
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
  const id = crypto.randomUUID();
  const output: Record<string, unknown> = {
    id,
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

  return {
    id,
    operational: output,
    technical: technicalLogFrom(row, id),
  };
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
  const prepared = operationalLogFrom(row);
  const { error } = await supabase
    .from("contact_processing_logs")
    .insert(prepared.operational);

  if (error) throw error;

  await insertTechnicalLogs(supabase, [prepared.technical]);
  notifyDiscordForOperationalRows(supabase, [prepared.operational]);
}

export async function insertContactLogs(supabase: AnySupabaseClient, rows: ContactLogRow[]) {
  if (rows.length === 0) return;
  const preparedRows = rows.map(operationalLogFrom);

  const { error } = await supabase
    .from("contact_processing_logs")
    .insert(preparedRows.map((row) => row.operational));

  if (error) throw error;

  await insertTechnicalLogs(supabase, preparedRows.map((row) => row.technical));
  notifyDiscordForOperationalRows(supabase, preparedRows.map((row) => row.operational));
}

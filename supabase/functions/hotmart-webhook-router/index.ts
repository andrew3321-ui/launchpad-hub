// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type JsonRecord = Record<string, unknown>;
type AnySupabaseClient = ReturnType<typeof createClient>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-launchhub-token, hottok",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;

  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPath(record: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = record;

  for (const part of parts) {
    const currentRecord = asRecord(current);
    if (!currentRecord || !(part in currentRecord)) return undefined;
    current = currentRecord[part];
  }

  return current;
}

function firstString(record: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = normalizeString(readPath(record, path));
    if (value) return value;
  }

  return null;
}

function firstNumber(record: unknown, paths: string[]): number | null {
  for (const path of paths) {
    const value = normalizeNumber(readPath(record, path));
    if (value !== null) return value;
  }

  return null;
}

function parseDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value !== "string" || !value.trim()) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && value.trim().length >= 10) {
    return parseDate(numeric);
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstDate(record: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = parseDate(readPath(record, path));
    if (value) return value;
  }

  return null;
}

async function readPayload(request: Request): Promise<JsonRecord> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const parsed = await request.json().catch(() => ({}));
    return asRecord(parsed) || {};
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries());
  }

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const payload: JsonRecord = {};
    for (const [key, value] of formData.entries()) {
      payload[key] = typeof value === "string" ? value : value.name;
    }
    return payload;
  }

  const text = await request.text();
  if (!text.trim()) return {};

  try {
    const parsed = JSON.parse(text);
    return asRecord(parsed) || {};
  } catch {
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries());
  }
}

function normalizeEventType(value: string | null, payload: JsonRecord) {
  const fallbackStatus = firstString(payload, [
    "data.purchase.status",
    "purchase.status",
    "purchase_status",
    "status",
  ]);

  return (value || fallbackStatus || "hotmart_event").trim().toLowerCase();
}

function buildEventKey(payload: JsonRecord, eventType: string) {
  const hotmartEventId = firstString(payload, ["id", "event_id", "webhook_event_id", "hotmart_event_id"]);
  const transactionCode = firstString(payload, [
    "data.purchase.transaction",
    "purchase.transaction",
    "transaction",
    "transaction_code",
    "transactionCode",
    "purchase.transaction_code",
  ]);
  const purchaseStatus = firstString(payload, [
    "data.purchase.status",
    "purchase.status",
    "purchase_status",
    "status",
  ]);
  const buyerEmail = firstString(payload, [
    "data.buyer.email",
    "buyer.email",
    "buyer_email",
    "email",
    "email_buyer",
  ]);
  const occurredAt = firstDate(payload, [
    "creation_date",
    "created_at",
    "data.purchase.order_date",
    "data.purchase.approved_date",
    "purchase.order_date",
    "purchase.approved_date",
    "date",
  ]);

  if (hotmartEventId) return `event:${hotmartEventId}`;

  return [
    eventType,
    transactionCode || "no-transaction",
    purchaseStatus || "no-status",
    buyerEmail || "no-email",
    occurredAt || "no-date",
  ].join("|");
}

function extractHotmartEvent(payload: JsonRecord, launch: { id: string; current_cycle_number: number | null }) {
  const rawEventType = firstString(payload, [
    "event",
    "event_type",
    "eventType",
    "type",
    "webhook_event_type",
    "data.event",
  ]);
  const eventType = normalizeEventType(rawEventType, payload);

  return {
    launch_id: launch.id,
    cycle_number: launch.current_cycle_number,
    event_key: buildEventKey(payload, eventType),
    event_type: eventType,
    hotmart_event_id: firstString(payload, ["id", "event_id", "webhook_event_id", "hotmart_event_id"]),
    transaction_code: firstString(payload, [
      "data.purchase.transaction",
      "purchase.transaction",
      "transaction",
      "transaction_code",
      "transactionCode",
      "purchase.transaction_code",
    ]),
    purchase_status: firstString(payload, [
      "data.purchase.status",
      "purchase.status",
      "purchase_status",
      "status",
    ]),
    product_id: firstString(payload, [
      "data.product.id",
      "product.id",
      "product_id",
      "prod",
      "productId",
    ]),
    product_name: firstString(payload, [
      "data.product.name",
      "product.name",
      "product_name",
      "productName",
      "prod_name",
    ]),
    offer_code: firstString(payload, [
      "data.purchase.offer.code",
      "data.offer.code",
      "purchase.offer.code",
      "offer.code",
      "offer_code",
      "offerCode",
    ]),
    buyer_name: firstString(payload, [
      "data.buyer.name",
      "buyer.name",
      "buyer_name",
      "name",
      "name_buyer",
      "customer.name",
    ]),
    buyer_email: firstString(payload, [
      "data.buyer.email",
      "buyer.email",
      "buyer_email",
      "email",
      "email_buyer",
      "customer.email",
    ]),
    buyer_phone: firstString(payload, [
      "data.buyer.checkout_phone",
      "data.buyer.phone",
      "buyer.checkout_phone",
      "buyer.phone",
      "buyer_phone",
      "phone",
      "phone_buyer",
      "customer.phone",
    ]),
    price_amount: firstNumber(payload, [
      "data.purchase.price.value",
      "data.purchase.full_price.value",
      "data.purchase.original_offer_price.value",
      "purchase.price.value",
      "price.value",
      "price",
      "value",
    ]),
    price_currency: firstString(payload, [
      "data.purchase.price.currency_code",
      "data.purchase.full_price.currency_code",
      "purchase.price.currency_code",
      "price.currency_code",
      "currency",
      "currency_code",
    ]),
    occurred_at: firstDate(payload, [
      "creation_date",
      "created_at",
      "data.purchase.order_date",
      "data.purchase.approved_date",
      "data.purchase.date_next_charge",
      "purchase.order_date",
      "purchase.approved_date",
      "date",
    ]),
    raw_payload: payload,
  };
}

async function findLaunch(supabase: AnySupabaseClient, expertSlug: string) {
  const bySlug = await supabase
    .from("launches")
    .select("id, name, slug, current_cycle_number")
    .eq("slug", expertSlug)
    .maybeSingle();

  if (bySlug.error) throw bySlug.error;
  if (bySlug.data) return bySlug.data;

  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expertSlug);
  if (!looksLikeUuid) return null;

  const byId = await supabase
    .from("launches")
    .select("id, name, slug, current_cycle_number")
    .eq("id", expertSlug)
    .maybeSingle();

  if (byId.error) throw byId.error;
  return byId.data;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase environment is not configured" }, 500);
    }

    const url = new URL(request.url);
    const expertSlug = normalizeString(url.searchParams.get("expertSlug") || url.searchParams.get("launchId"));
    const providedToken = normalizeString(
      url.searchParams.get("token") ||
        request.headers.get("x-launchhub-token") ||
        request.headers.get("hottok"),
    );

    if (!expertSlug || !providedToken) {
      return jsonResponse({ error: "Missing expertSlug or token" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const launch = await findLaunch(supabase, expertSlug);

    if (!launch) {
      return jsonResponse({ error: "Expert not found" }, 404);
    }

    const { data: settings, error: settingsError } = await supabase
      .from("hotmart_webhook_settings")
      .select("enabled, webhook_token")
      .eq("launch_id", launch.id)
      .maybeSingle();

    if (settingsError) throw settingsError;

    if (!settings || !settings.enabled || settings.webhook_token !== providedToken) {
      return jsonResponse({ error: "Unauthorized Hotmart webhook" }, 401);
    }

    const payload = await readPayload(request);
    const eventRow = extractHotmartEvent(payload, launch);

    const { error: insertError } = await supabase.from("hotmart_events").insert(eventRow);

    if (insertError && insertError.code !== "23505") {
      throw insertError;
    }

    return jsonResponse({
      ok: true,
      duplicate: insertError?.code === "23505",
      expert: launch.slug || launch.id,
      eventType: eventRow.event_type,
      transactionCode: eventRow.transaction_code,
    });
  } catch (error) {
    console.error("hotmart-webhook-router failed", error);

    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unexpected Hotmart webhook error",
      },
      500,
    );
  }
});

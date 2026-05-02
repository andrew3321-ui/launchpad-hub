import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  readPlatformRateLimit,
  waitForPlatformRateLimit,
} from "../_shared/platform-rate-limit.ts";

type JsonRecord = Record<string, unknown>;
const ACTIVECAMPAIGN_REQUEST_TIMEOUT_MS = 12000;
const PLATFORM_RATE_LIMIT_MAX_WAIT_MS = Number(Deno.env.get("LAUNCHHUB_CATALOG_RATE_LIMIT_MAX_WAIT_MS") || 5000);
let platformRateLimitClient: any | null = null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function nonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeActiveCampaignBaseUrl(apiUrl: string) {
  const trimmed = apiUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/api/3") ? trimmed.slice(0, -6) : trimmed;
}

async function enforceActiveCampaignRateLimit(apiUrl: string) {
  if (!platformRateLimitClient) return;

  await waitForPlatformRateLimit(platformRateLimitClient, {
    provider: "activecampaign",
    scopeKey: normalizeActiveCampaignBaseUrl(apiUrl),
    limitPerMinute: readPlatformRateLimit("activecampaign"),
    maxWaitMs: PLATFORM_RATE_LIMIT_MAX_WAIT_MS,
  });
}

async function requestJson(
  url: string,
  init: RequestInit,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ACTIVECAMPAIGN_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const rawText = await response.text();
    let parsed: unknown = {};

    if (rawText.trim()) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = { rawText };
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${rawText}`);
    }

    return parsed;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("A consulta ao ActiveCampaign demorou demais para responder.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function activeCampaignRequest(
  apiUrl: string,
  apiKey: string,
  path: string,
  query: Record<string, string | number | undefined> = {},
) {
  const url = new URL(`${normalizeActiveCampaignBaseUrl(apiUrl)}${path}`);

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  await enforceActiveCampaignRateLimit(apiUrl);

  return await requestJson(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Api-Token": apiKey,
    },
  });
}

async function loadAllTags(apiUrl: string, apiKey: string) {
  const tags: Array<{ id: string; name: string; description: string | null }> = [];
  let offset = 0;

  while (true) {
    const payload = await activeCampaignRequest(apiUrl, apiKey, "/api/3/tags", {
      limit: 100,
      offset,
    });

    const batch = Array.isArray((payload as JsonRecord).tags)
      ? ((payload as JsonRecord).tags as unknown[])
      : [];

    if (batch.length === 0) break;

    batch.forEach((item) => {
      if (!isRecord(item)) return;

      const id = nonEmptyString(item.id);
      const name = nonEmptyString(item.tag);
      const description = nonEmptyString(item.description);

      if (!id || !name) return;
      tags.push({ id, name, description });
    });

    offset += batch.length;
    if (batch.length < 100) break;
  }

  return tags.sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && serviceRoleKey) {
      platformRateLimitClient = createClient(supabaseUrl, serviceRoleKey);
    }

    const payload = (await request.json()) as JsonRecord;
    const apiUrl = nonEmptyString(payload.apiUrl);
    const apiKey = nonEmptyString(payload.apiKey);

    if (!apiUrl || !apiKey) {
      return jsonResponse({ error: "apiUrl and apiKey are required" }, 400);
    }

    const tags = await loadAllTags(apiUrl, apiKey);

    return jsonResponse({
      tags,
      loadedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Unexpected error",
      },
      500,
    );
  }
});

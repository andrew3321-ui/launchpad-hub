// deno-lint-ignore-file no-explicit-any
export type PlatformProvider = "activecampaign" | "uchat" | "google_sheets";

export interface PlatformRateLimitOptions {
  provider: PlatformProvider;
  scopeKey: string;
  limitPerMinute: number;
  weight?: number;
  maxWaitMs?: number;
}

export interface PlatformRateLimitDetails {
  provider: PlatformProvider;
  scopeKey: string;
  limitPerMinute: number;
  requestCount: number;
  retryAfterMs: number;
}

export class PlatformRateLimitExceededError extends Error {
  details: PlatformRateLimitDetails;

  constructor(details: PlatformRateLimitDetails) {
    super(`Platform rate limit exceeded for ${details.provider}`);
    this.name = "PlatformRateLimitExceededError";
    this.details = details;
  }
}

const DEFAULT_LIMITS: Record<PlatformProvider, number> = {
  activecampaign: 120,
  uchat: 60,
  google_sheets: 80,
};

const ENV_BY_PROVIDER: Record<PlatformProvider, string> = {
  activecampaign: "LAUNCHHUB_RATE_LIMIT_ACTIVECAMPAIGN_PER_MINUTE",
  uchat: "LAUNCHHUB_RATE_LIMIT_UCHAT_PER_MINUTE",
  google_sheets: "LAUNCHHUB_RATE_LIMIT_GOOGLE_SHEETS_PER_MINUTE",
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.trunc(parsed));
}

export function readPlatformRateLimit(provider: PlatformProvider, fallback = DEFAULT_LIMITS[provider]) {
  return clampPositiveInteger(Deno.env.get(ENV_BY_PROVIDER[provider]), fallback);
}

export function stableRateLimitKey(input: string | null | undefined) {
  const value = String(input || "global");
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `h${(hash >>> 0).toString(36)}`;
}

function normalizeScopeKey(scopeKey: string | null | undefined) {
  const value = String(scopeKey || "global").trim();
  return value || "global";
}

function parseRateLimitResult(data: unknown) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  return row as {
    allowed?: boolean;
    request_count?: number;
    retry_after_ms?: number;
  };
}

export async function waitForPlatformRateLimit(
  supabase: any,
  options: PlatformRateLimitOptions,
) {
  const maxWaitMs = clampPositiveInteger(options.maxWaitMs, 2500);
  const startedAt = Date.now();
  const provider = options.provider;
  const scopeKey = normalizeScopeKey(options.scopeKey);
  const limitPerMinute = clampPositiveInteger(options.limitPerMinute, DEFAULT_LIMITS[provider]);
  const weight = clampPositiveInteger(options.weight, 1);

  while (true) {
    const { data, error } = await supabase.rpc("consume_platform_rate_limit", {
      p_provider: provider,
      p_scope_key: scopeKey,
      p_limit_per_minute: limitPerMinute,
      p_weight: weight,
    });

    if (error) {
      console.warn("platform rate limit unavailable; continuing without throttle", {
        provider,
        message: error.message,
      });
      return {
        allowed: true,
        requestCount: 0,
        retryAfterMs: 0,
      };
    }

    const result = parseRateLimitResult(data);
    const allowed = result?.allowed !== false;
    const requestCount = Number(result?.request_count || 0);
    const retryAfterMs = clampPositiveInteger(result?.retry_after_ms, 1000);

    if (allowed) {
      return {
        allowed: true,
        requestCount,
        retryAfterMs: 0,
      };
    }

    const elapsedMs = Date.now() - startedAt;
    const remainingMs = maxWaitMs - elapsedMs;

    if (remainingMs <= 0) {
      throw new PlatformRateLimitExceededError({
        provider,
        scopeKey,
        limitPerMinute,
        requestCount,
        retryAfterMs,
      });
    }

    await delay(Math.min(retryAfterMs, remainingMs));
  }
}

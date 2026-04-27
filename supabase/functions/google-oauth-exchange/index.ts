import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ProcessContactError } from "../_shared/contact-processing.ts";
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserProfile,
} from "../_shared/google-sheets.ts";

type AnySupabaseClient = any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-requested-with",
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

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function requireAuthenticatedUser(request: Request, supabaseUrl: string, serviceRoleKey: string) {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authorization) {
    throw new ProcessContactError("Missing authorization header", 401);
  }

  const userAuthKey =
    Deno.env.get("SUPABASE_ANON_KEY") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ||
    Deno.env.get("SB_PUBLISHABLE_KEY") ||
    serviceRoleKey;

  const authClient = createClient(supabaseUrl, userAuthKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();

  if (error || !user) {
    throw new ProcessContactError("Unauthorized", 401, error?.message);
  }

  return user;
}

async function assertLaunchAccess(
  supabase: AnySupabaseClient,
  userId: string,
  launchId: string | null,
) {
  if (!launchId) {
    throw new ProcessContactError("launchId is required", 400);
  }

  const { data: allowed, error } = await supabase.rpc("user_owns_launch", {
    _launch_id: launchId,
    _user_id: userId,
  });

  if (error) {
    throw new ProcessContactError("Failed to validate expert access", 500, error.message);
  }

  if (!allowed) {
    throw new ProcessContactError("Expert access denied", 403);
  }
}

async function fetchExistingLaunchOauthState(
  supabase: AnySupabaseClient,
  launchId: string,
) {
  const { data, error } = await supabase
    .from("launches")
    .select("id, name, slug, project_id, webhook_secret, ac_api_url, ac_api_key, ac_default_list_id, ac_named_tags, current_cycle_number, current_cycle_started_at, gs_enabled, gs_auth_mode, gs_service_account_email, gs_private_key, gs_spreadsheet_id, gs_spreadsheet_title, gs_sheet_name, gs_oauth_email, gs_oauth_refresh_token")
    .eq("id", launchId)
    .maybeSingle();

  if (error || !data) {
    throw new ProcessContactError("Expert not found", 404, error?.message);
  }

  return data as Record<string, unknown>;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Supabase environment variables" }, 500);
  }

  try {
    const requestedWith = normalizeString(request.headers.get("x-requested-with"));
    if (requestedWith !== "XMLHttpRequest") {
      throw new ProcessContactError("Missing CSRF protection header", 400);
    }

    const body = await request.json() as {
      launchId?: string | null;
      code?: string | null;
      redirectUri?: string | null;
    };

    const launchId = normalizeString(body.launchId);
    const code = normalizeString(body.code);
    const redirectUri = normalizeString(body.redirectUri);

    if (!launchId || !code || !redirectUri) {
      throw new ProcessContactError("launchId, code and redirectUri are required", 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authenticatedUser = await requireAuthenticatedUser(request, supabaseUrl, serviceRoleKey);

    await assertLaunchAccess(supabase, authenticatedUser.id, launchId);

    const currentLaunch = await fetchExistingLaunchOauthState(supabase, launchId);
    const tokenResult = await exchangeGoogleAuthorizationCode({
      code,
      redirectUri,
    });

    if (!tokenResult.accessToken) {
      throw new ProcessContactError("Google OAuth did not return an access token", 502);
    }

    const profile = await fetchGoogleUserProfile(tokenResult.accessToken);
    const nextRefreshToken =
      tokenResult.refreshToken ||
      normalizeString(currentLaunch.gs_oauth_refresh_token);

    if (!nextRefreshToken) {
      throw new ProcessContactError(
        "Google nao devolveu refresh token. Remova o acesso anterior do app na sua conta Google e conecte novamente com consentimento.",
        400,
      );
    }

    const { data, error } = await supabase
      .from("launches")
      .update({
        gs_auth_mode: "oauth",
        gs_oauth_email: profile.email,
        gs_oauth_refresh_token: nextRefreshToken,
      } as Record<string, unknown>)
      .eq("id", launchId)
      .select("id, name, slug, project_id, webhook_secret, ac_api_url, ac_api_key, ac_default_list_id, ac_named_tags, current_cycle_number, current_cycle_started_at, gs_enabled, gs_auth_mode, gs_service_account_email, gs_private_key, gs_spreadsheet_id, gs_spreadsheet_title, gs_sheet_name, gs_oauth_email")
      .maybeSingle();

    if (error || !data) {
      throw new ProcessContactError("Failed to save Google OAuth connection", 500, error?.message);
    }

    return jsonResponse({
      connected: true,
      email: profile.email,
      launch: {
        ...(data as Record<string, unknown>),
        gs_oauth_connected: true,
      },
    });
  } catch (error) {
    if (error instanceof ProcessContactError) {
      return jsonResponse({ error: error.message, details: error.details ?? null }, error.statusCode);
    }

    console.error("google-oauth-exchange failed", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected Google OAuth error" },
      500,
    );
  }
});

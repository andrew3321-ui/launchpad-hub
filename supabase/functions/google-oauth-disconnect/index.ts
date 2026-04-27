import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ProcessContactError } from "../_shared/contact-processing.ts";
import { revokeGoogleRefreshToken } from "../_shared/google-sheets.ts";

type AnySupabaseClient = any;

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
    const body = await request.json() as {
      launchId?: string | null;
    };
    const launchId = normalizeString(body.launchId);
    if (!launchId) {
      throw new ProcessContactError("launchId is required", 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authenticatedUser = await requireAuthenticatedUser(request, supabaseUrl, serviceRoleKey);

    await assertLaunchAccess(supabase, authenticatedUser.id, launchId);

    const { data: currentLaunch, error: fetchError } = await supabase
      .from("launches")
      .select("gs_oauth_refresh_token")
      .eq("id", launchId)
      .maybeSingle();

    if (fetchError || !currentLaunch) {
      throw new ProcessContactError("Expert not found", 404, fetchError?.message);
    }

    const refreshToken = normalizeString(currentLaunch.gs_oauth_refresh_token);
    if (refreshToken) {
      try {
        await revokeGoogleRefreshToken(refreshToken);
      } catch (error) {
        console.warn("google-oauth-disconnect revoke failed", error);
      }
    }

    const { data, error } = await supabase
      .from("launches")
      .update({
        gs_enabled: false,
        gs_oauth_email: null,
        gs_oauth_refresh_token: null,
        gs_spreadsheet_id: null,
        gs_spreadsheet_title: null,
        gs_sheet_name: null,
      } as Record<string, unknown>)
      .eq("id", launchId)
      .select("id, name, slug, project_id, webhook_secret, ac_api_url, ac_api_key, ac_default_list_id, ac_named_tags, current_cycle_number, current_cycle_started_at, gs_enabled, gs_auth_mode, gs_service_account_email, gs_private_key, gs_spreadsheet_id, gs_spreadsheet_title, gs_sheet_name, gs_oauth_email")
      .maybeSingle();

    if (error || !data) {
      throw new ProcessContactError("Failed to disconnect Google account", 500, error?.message);
    }

    return jsonResponse({
      disconnected: true,
      launch: {
        ...(data as Record<string, unknown>),
        gs_oauth_connected: false,
      },
    });
  } catch (error) {
    if (error instanceof ProcessContactError) {
      return jsonResponse({ error: error.message, details: error.details ?? null }, error.statusCode);
    }

    console.error("google-oauth-disconnect failed", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected Google OAuth error" },
      500,
    );
  }
});

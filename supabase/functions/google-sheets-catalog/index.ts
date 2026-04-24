import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ProcessContactError } from "../_shared/contact-processing.ts";
import { fetchGoogleSpreadsheetCatalog } from "../_shared/google-sheets.ts";

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
      serviceAccountEmail?: string | null;
      privateKey?: string | null;
      spreadsheetId?: string | null;
    };
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authenticatedUser = await requireAuthenticatedUser(request, supabaseUrl, serviceRoleKey);

    await assertLaunchAccess(
      supabase,
      authenticatedUser.id,
      typeof body.launchId === "string" ? body.launchId : null,
    );

    const catalog = await fetchGoogleSpreadsheetCatalog({
      enabled: true,
      serviceAccountEmail: body.serviceAccountEmail,
      privateKey: body.privateKey,
      spreadsheetId: body.spreadsheetId,
      sheetName: "tmp",
    });

    return jsonResponse(catalog);
  } catch (error) {
    if (error instanceof ProcessContactError) {
      return jsonResponse({ error: error.message, details: error.details ?? null }, error.statusCode);
    }

    console.error("google-sheets-catalog failed", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected Google Sheets error" },
      500,
    );
  }
});

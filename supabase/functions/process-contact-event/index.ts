import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  ProcessContactError,
  processIncomingContactEvent,
} from "../_shared/contact-processing.ts";

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
  supabase: ReturnType<typeof createClient>,
  userId: string,
  launchId: string | null,
  launchSlug: string | null,
) {
  const lookup = launchId
    ? supabase.from("launches").select("id").eq("id", launchId).maybeSingle()
    : supabase.from("launches").select("id").eq("slug", launchSlug as string).maybeSingle();

  const { data: launch, error: lookupError } = await lookup;

  if (lookupError || !launch?.id) {
    throw new ProcessContactError("Launch not found", 404, lookupError?.message);
  }

  const { data: allowed, error: accessError } = await supabase.rpc("user_owns_launch", {
    _launch_id: launch.id,
    _user_id: userId,
  });

  if (accessError) {
    throw new ProcessContactError("Failed to validate launch access", 500, accessError.message);
  }

  if (!allowed) {
    throw new ProcessContactError("Launch access denied", 403);
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authenticatedUser = await requireAuthenticatedUser(request, supabaseUrl, serviceRoleKey);
    const eventBody = body as { launchId?: string | null; launchSlug?: string | null };

    await assertLaunchAccess(
      supabase,
      authenticatedUser.id,
      typeof eventBody.launchId === "string" ? eventBody.launchId : null,
      typeof eventBody.launchSlug === "string" ? eventBody.launchSlug : null,
    );

    const result = await processIncomingContactEvent(supabase, body as never);
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof ProcessContactError) {
      return jsonResponse(
        {
          error: error.message,
          details: error.details ?? null,
        },
        error.statusCode,
      );
    }

    console.error("process-contact-event failed", error);
    return jsonResponse({ error: "Unexpected processing error" }, 500);
  }
});

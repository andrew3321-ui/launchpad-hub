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

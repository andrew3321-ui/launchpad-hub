import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AnySupabaseClient = any;

interface AdminUserRequest {
  action: "reset-password" | "delete-user";
  userId?: string;
  password?: string;
}

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

async function requireAuthenticatedAdmin(
  request: Request,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const authorization = request.headers.get("authorization") || request.headers.get("Authorization");
  if (!authorization) {
    return { error: jsonResponse({ error: "Missing authorization header" }, 401), userId: null };
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
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return { error: jsonResponse({ error: "Unauthorized" }, 401), userId: null };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("is_admin, approval_status, must_change_password")
    .eq("user_id", user.id)
    .maybeSingle();

  const isAdmin =
    !profileError &&
    profile?.is_admin === true &&
    profile?.approval_status === "approved" &&
    profile?.must_change_password === false;

  if (!isAdmin) {
    return { error: jsonResponse({ error: "Admin access required" }, 403), userId: null };
  }

  return { error: null, userId: user.id };
}

async function loadTargetProfile(adminClient: AnySupabaseClient, userId: string) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id, user_id, email, full_name, is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
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

  let body: AdminUserRequest;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const targetUserId = normalizeString(body.userId);
  if (!targetUserId) {
    return jsonResponse({ error: "userId is required" }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const authCheck = await requireAuthenticatedAdmin(request, supabaseUrl, serviceRoleKey);
  if (authCheck.error) {
    return authCheck.error;
  }

  try {
    const targetProfile = await loadTargetProfile(adminClient, targetUserId);
    if (!targetProfile) {
      return jsonResponse({ error: "User profile not found" }, 404);
    }

    if (body.action === "reset-password") {
      const password = normalizeString(body.password);

      if (!password || password.length < 8) {
        return jsonResponse({ error: "Password must have at least 8 characters" }, 400);
      }

      const { error } = await adminClient.auth.admin.updateUserById(targetUserId, {
        password,
      });

      if (error) {
        return jsonResponse({ error: error.message }, 500);
      }

      await adminClient
        .from("profiles")
        .update({
          must_change_password: true,
          password_changed_at: null,
        })
        .eq("user_id", targetUserId);

      return jsonResponse({
        ok: true,
        action: "reset-password",
        userId: targetUserId,
      });
    }

    if (body.action === "delete-user") {
      if (targetProfile.is_admin) {
        return jsonResponse({ error: "Admin users cannot be deleted from this panel" }, 422);
      }

      const replacementOwnerId = authCheck.userId as string;
      await Promise.all([
        adminClient.from("launches").update({ created_by: replacementOwnerId }).eq("created_by", targetUserId),
        adminClient.from("projects").update({ created_by: replacementOwnerId }).eq("created_by", targetUserId),
        adminClient
          .from("launch_cycle_archives")
          .update({ created_by: replacementOwnerId })
          .eq("created_by", targetUserId),
      ]);

      const { error } = await adminClient.auth.admin.deleteUser(targetUserId);

      if (error) {
        return jsonResponse({ error: error.message }, 500);
      }

      return jsonResponse({
        ok: true,
        action: "delete-user",
        userId: targetUserId,
      });
    }

    return jsonResponse({ error: "Unsupported action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected admin action error";
    return jsonResponse({ error: message }, 500);
  }
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ProcessContactError } from "../_shared/contact-processing.ts";
import {
  fetchGoogleSpreadsheetCatalog,
  listGoogleSpreadsheets,
  type GoogleSheetsAuthMode,
  type GoogleSheetsConfigInput,
} from "../_shared/google-sheets.ts";

type AnySupabaseClient = any;

interface LaunchGoogleSheetsRow {
  gs_auth_mode: GoogleSheetsAuthMode | null;
  gs_enabled: boolean;
  gs_oauth_email: string | null;
  gs_oauth_refresh_token: string | null;
  gs_private_key: string | null;
  gs_service_account_email: string | null;
  gs_sheet_name: string | null;
  gs_spreadsheet_id: string | null;
  gs_spreadsheet_title: string | null;
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

async function fetchLaunchGoogleSheetsConfig(
  supabase: AnySupabaseClient,
  launchId: string,
) {
  const { data, error } = await supabase
    .from("launches")
    .select("gs_auth_mode, gs_enabled, gs_oauth_email, gs_oauth_refresh_token, gs_private_key, gs_service_account_email, gs_sheet_name, gs_spreadsheet_id, gs_spreadsheet_title")
    .eq("id", launchId)
    .maybeSingle();

  if (error || !data) {
    throw new ProcessContactError("Expert Google Sheets settings not found", 404, error?.message);
  }

  return data as LaunchGoogleSheetsRow;
}

function buildCatalogConfig(
  launch: LaunchGoogleSheetsRow,
  body: {
    serviceAccountEmail?: string | null;
    privateKey?: string | null;
    spreadsheetId?: string | null;
    listOnly?: boolean | null;
  },
): GoogleSheetsConfigInput {
  const bodyServiceAccountEmail = normalizeString(body.serviceAccountEmail);
  const bodyPrivateKey = typeof body.privateKey === "string" && body.privateKey.trim()
    ? body.privateKey
    : null;
  const bodySpreadsheetId = normalizeString(body.spreadsheetId);
  const listOnly = Boolean(body.listOnly);

  if (bodyServiceAccountEmail || bodyPrivateKey) {
    return {
      enabled: true,
      authMode: "service_account",
      serviceAccountEmail: bodyServiceAccountEmail,
      privateKey: bodyPrivateKey,
      spreadsheetId: listOnly ? null : bodySpreadsheetId,
      sheetName: launch.gs_sheet_name,
    };
  }

  return {
    enabled: true,
    authMode: launch.gs_auth_mode ?? "service_account",
    serviceAccountEmail: launch.gs_service_account_email,
    privateKey: launch.gs_private_key,
    oauthRefreshToken: launch.gs_oauth_refresh_token,
    spreadsheetId: listOnly ? null : (bodySpreadsheetId ?? launch.gs_spreadsheet_id),
    sheetName: launch.gs_sheet_name,
  };
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
      listOnly?: boolean | null;
    };
    const launchId = normalizeString(body.launchId);
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const authenticatedUser = await requireAuthenticatedUser(request, supabaseUrl, serviceRoleKey);

    await assertLaunchAccess(supabase, authenticatedUser.id, launchId);

    const launch = await fetchLaunchGoogleSheetsConfig(supabase, launchId as string);
    const config = buildCatalogConfig(launch, body);
    const requestedSpreadsheetId = normalizeString(body.spreadsheetId);
    const listOnly = Boolean(body.listOnly);

    const spreadsheets =
      config.authMode === "oauth"
        ? await listGoogleSpreadsheets(config)
        : requestedSpreadsheetId
          ? [
              {
                id: requestedSpreadsheetId,
                title: launch.gs_spreadsheet_title,
                modifiedTime: null,
                ownerEmail: null,
                ownerName: null,
              },
            ]
          : [];

    let selectedSpreadsheetId = listOnly
      ? null
      : requestedSpreadsheetId ?? launch.gs_spreadsheet_id;
    let selectedSpreadsheetTitle = launch.gs_spreadsheet_title ?? null;
    let catalog = null;
    let catalogWarning: string | null = null;

    if (selectedSpreadsheetId) {
      try {
        catalog = await fetchGoogleSpreadsheetCatalog({
          ...config,
          spreadsheetId: selectedSpreadsheetId,
        });
        selectedSpreadsheetTitle = catalog?.title ?? selectedSpreadsheetTitle;
      } catch (error) {
        if (config.authMode === "service_account") {
          throw error;
        }

        const existsInList = spreadsheets.some((spreadsheet) => spreadsheet.id === selectedSpreadsheetId);
        if (!existsInList) {
          selectedSpreadsheetId = null;
          selectedSpreadsheetTitle = null;
        }

        catalogWarning = error instanceof Error
          ? error.message
          : "The selected spreadsheet could not be loaded.";
      }
    }

    return jsonResponse({
      authMode: config.authMode,
      connectionEmail: config.authMode === "oauth" ? launch.gs_oauth_email : launch.gs_service_account_email,
      spreadsheets,
      selectedSpreadsheetId: selectedSpreadsheetId,
      selectedSpreadsheetTitle: selectedSpreadsheetTitle,
      sheets: catalog?.sheets ?? [],
      catalogWarning,
    });
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

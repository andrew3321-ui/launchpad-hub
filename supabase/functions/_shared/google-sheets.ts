type JsonRecord = Record<string, unknown>;

export type GoogleSheetsAuthMode = "service_account" | "oauth";

export interface GoogleSheetsConfigInput {
  enabled?: boolean | null;
  authMode?: GoogleSheetsAuthMode | string | null;
  serviceAccountEmail?: string | null;
  privateKey?: string | null;
  oauthRefreshToken?: string | null;
  oauthClientId?: string | null;
  oauthClientSecret?: string | null;
  spreadsheetId?: string | null;
  sheetName?: string | null;
}

export interface GoogleSpreadsheetListItem {
  id: string;
  title: string | null;
  modifiedTime: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
}

export interface GoogleSpreadsheetCatalog {
  spreadsheetId: string;
  title: string | null;
  sheets: Array<{
    id: number | null;
    title: string | null;
    index: number | null;
  }>;
}

export interface GoogleTokenExchangeResult {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string | null;
  idToken: string | null;
}

export interface GoogleUserProfile {
  email: string | null;
  name: string | null;
  picture: string | null;
  sub: string | null;
}

const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_DRIVE_METADATA_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";
const GOOGLE_USERINFO_SCOPES = ["openid", "email", "profile"] as const;
const GOOGLE_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

type ResolvedGoogleSheetsRuntimeConfig = {
  enabled: boolean;
  spreadsheetId: string;
  sheetName: string;
} & (
  | {
      authMode: "service_account";
      serviceAccountEmail: string;
      privateKey: string;
    }
  | {
      authMode: "oauth";
      oauthRefreshToken: string;
      oauthClientId: string;
      oauthClientSecret: string;
    }
);

type ResolvedGoogleSheetsCatalogConfig =
  | {
      authMode: "service_account";
      serviceAccountEmail: string;
      privateKey: string;
      spreadsheetId: string;
    }
  | {
      authMode: "oauth";
      oauthRefreshToken: string;
      oauthClientId: string;
      oauthClientSecret: string;
      spreadsheetId: string;
    };

type ResolvedGoogleSheetsAuthConfig =
  | {
      authMode: "service_account";
      serviceAccountEmail: string;
      privateKey: string;
    }
  | {
      authMode: "oauth";
      oauthRefreshToken: string;
      oauthClientId: string;
      oauthClientSecret: string;
    };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeGoogleSheetsAuthMode(value: unknown): GoogleSheetsAuthMode {
  return value === "oauth" ? "oauth" : "service_account";
}

function encodeBase64Url(input: string | Uint8Array) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(privateKey: string) {
  const normalized = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function normalizePrivateKey(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

function normalizeGoogleClientId(value?: string | null) {
  return nonEmptyString(value ?? Deno.env.get("GOOGLE_OAUTH_CLIENT_ID"));
}

function normalizeGoogleClientSecret(value?: string | null) {
  return nonEmptyString(value ?? Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET"));
}

function parseGoogleTokenResponse(rawText: string) {
  let payload: unknown = {};

  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { rawText };
  }

  return payload;
}

function resolveGoogleSheetsAuthConfig(
  config: GoogleSheetsConfigInput,
): ResolvedGoogleSheetsAuthConfig | null {
  const authMode = normalizeGoogleSheetsAuthMode(config.authMode);

  if (authMode === "oauth") {
    const oauthRefreshToken = nonEmptyString(config.oauthRefreshToken);
    const oauthClientId = normalizeGoogleClientId(config.oauthClientId);
    const oauthClientSecret = normalizeGoogleClientSecret(config.oauthClientSecret);

    if (!oauthRefreshToken || !oauthClientId || !oauthClientSecret) {
      return null;
    }

    return {
      authMode,
      oauthRefreshToken,
      oauthClientId,
      oauthClientSecret,
    };
  }

  const serviceAccountEmail = nonEmptyString(config.serviceAccountEmail);
  const privateKey = nonEmptyString(config.privateKey);

  if (!serviceAccountEmail || !privateKey) {
    return null;
  }

  return {
    authMode,
    serviceAccountEmail,
    privateKey,
  };
}

function resolveGoogleSheetsRuntimeConfig(
  config: GoogleSheetsConfigInput,
): ResolvedGoogleSheetsRuntimeConfig | null {
  const auth = resolveGoogleSheetsAuthConfig(config);
  const spreadsheetId = nonEmptyString(config.spreadsheetId);
  const sheetName = nonEmptyString(config.sheetName);
  const enabled = Boolean(config.enabled);

  if (!enabled || !auth || !spreadsheetId || !sheetName) {
    return null;
  }

  return {
    enabled,
    spreadsheetId,
    sheetName,
    ...auth,
  };
}

function resolveGoogleSheetsCatalogConfig(
  config: GoogleSheetsConfigInput,
): ResolvedGoogleSheetsCatalogConfig | null {
  const auth = resolveGoogleSheetsAuthConfig(config);
  const spreadsheetId = nonEmptyString(config.spreadsheetId);

  if (!auth || !spreadsheetId) {
    return null;
  }

  return {
    spreadsheetId,
    ...auth,
  };
}

async function signJwt(serviceAccountEmail: string, privateKey: string, scopes: string[]) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccountEmail,
    scope: scopes.join(" "),
    aud: GOOGLE_TOKEN_AUDIENCE,
    exp: issuedAt + 3600,
    iat: issuedAt,
  };

  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(normalizePrivateKey(privateKey)),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function getServiceAccountAccessToken(
  serviceAccountEmail: string,
  privateKey: string,
  scopes: string[],
) {
  const assertion = await signJwt(serviceAccountEmail, privateKey, scopes);
  const response = await fetch(GOOGLE_TOKEN_AUDIENCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  const rawText = await response.text();
  const payload = parseGoogleTokenResponse(rawText);

  if (!response.ok) {
    throw new Error(`Google OAuth ${response.status}: ${rawText}`);
  }

  const accessToken = nonEmptyString(isRecord(payload) ? payload.access_token : null);
  if (!accessToken) {
    throw new Error("Google OAuth did not return an access token.");
  }

  return accessToken;
}

async function getOauthAccessToken(
  oauthClientId: string,
  oauthClientSecret: string,
  oauthRefreshToken: string,
) {
  const response = await fetch(GOOGLE_TOKEN_AUDIENCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      refresh_token: oauthRefreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  const rawText = await response.text();
  const payload = parseGoogleTokenResponse(rawText);

  if (!response.ok) {
    throw new Error(`Google OAuth ${response.status}: ${rawText}`);
  }

  const accessToken = nonEmptyString(isRecord(payload) ? payload.access_token : null);
  if (!accessToken) {
    throw new Error("Google OAuth did not return an access token.");
  }

  return accessToken;
}

async function getGoogleAccessToken(
  config: ResolvedGoogleSheetsAuthConfig,
  scopes: string[],
) {
  if (config.authMode === "oauth") {
    return getOauthAccessToken(
      config.oauthClientId,
      config.oauthClientSecret,
      config.oauthRefreshToken,
    );
  }

  return getServiceAccountAccessToken(config.serviceAccountEmail, config.privateKey, scopes);
}

function buildSheetsApiUrl(path: string, searchParams?: Record<string, string>) {
  const url = new URL(`https://sheets.googleapis.com/v4/${path.replace(/^\/+/, "")}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function buildDriveApiUrl(path: string, searchParams?: Record<string, string>) {
  const url = new URL(`https://www.googleapis.com/drive/v3/${path.replace(/^\/+/, "")}`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function googleSheetsRequest(
  accessToken: string,
  path: string,
  init?: RequestInit,
  searchParams?: Record<string, string>,
) {
  const response = await fetch(buildSheetsApiUrl(path, searchParams), {
    ...(init ?? {}),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const rawText = await response.text();
  const payload = parseGoogleTokenResponse(rawText);

  if (!response.ok) {
    throw new Error(`Google Sheets ${response.status}: ${rawText}`);
  }

  return payload;
}

async function googleDriveRequest(
  accessToken: string,
  path: string,
  searchParams?: Record<string, string>,
) {
  const response = await fetch(buildDriveApiUrl(path, searchParams), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const rawText = await response.text();
  const payload = parseGoogleTokenResponse(rawText);

  if (!response.ok) {
    throw new Error(`Google Drive ${response.status}: ${rawText}`);
  }

  return payload;
}

function buildSheetRange(sheetName: string, cells = "A:Z") {
  const escapedSheetName = sheetName.replace(/'/g, "''");
  return `'${escapedSheetName}'!${cells}`;
}

export function getGoogleSheetsOauthScopes() {
  return [
    GOOGLE_SHEETS_SCOPE,
    GOOGLE_DRIVE_METADATA_SCOPE,
    ...GOOGLE_USERINFO_SCOPES,
  ];
}

export function parseGoogleSheetsConfig(config: GoogleSheetsConfigInput) {
  return resolveGoogleSheetsRuntimeConfig(config);
}

export async function exchangeGoogleAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  clientId?: string | null;
  clientSecret?: string | null;
}) {
  const clientId = normalizeGoogleClientId(input.clientId);
  const clientSecret = normalizeGoogleClientSecret(input.clientSecret);

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client is not configured.");
  }

  const code = nonEmptyString(input.code);
  const redirectUri = nonEmptyString(input.redirectUri);

  if (!code || !redirectUri) {
    throw new Error("Google OAuth code exchange is missing required parameters.");
  }

  const response = await fetch(GOOGLE_TOKEN_AUDIENCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  const rawText = await response.text();
  const payload = parseGoogleTokenResponse(rawText);

  if (!response.ok) {
    throw new Error(`Google OAuth ${response.status}: ${rawText}`);
  }

  const root = isRecord(payload) ? payload : {};

  return {
    accessToken: nonEmptyString(root.access_token) ?? "",
    refreshToken: nonEmptyString(root.refresh_token),
    expiresIn: typeof root.expires_in === "number" ? root.expires_in : Number(root.expires_in) || null,
    scope: nonEmptyString(root.scope),
    tokenType: nonEmptyString(root.token_type),
    idToken: nonEmptyString(root.id_token),
  } satisfies GoogleTokenExchangeResult;
}

export async function fetchGoogleUserProfile(accessToken: string) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const rawText = await response.text();
  const payload = parseGoogleTokenResponse(rawText);

  if (!response.ok) {
    throw new Error(`Google userinfo ${response.status}: ${rawText}`);
  }

  const root = isRecord(payload) ? payload : {};

  return {
    email: nonEmptyString(root.email),
    name: nonEmptyString(root.name),
    picture: nonEmptyString(root.picture),
    sub: nonEmptyString(root.sub),
  } satisfies GoogleUserProfile;
}

export async function revokeGoogleRefreshToken(refreshToken: string) {
  const normalized = nonEmptyString(refreshToken);
  if (!normalized) {
    return;
  }

  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      token: normalized,
    }).toString(),
  });
}

export async function listGoogleSpreadsheets(config: GoogleSheetsConfigInput) {
  const auth = resolveGoogleSheetsAuthConfig({
    ...config,
    enabled: true,
  });

  if (!auth) {
    throw new Error("Google Sheets authentication is incomplete.");
  }

  const accessToken = await getGoogleAccessToken(auth, [
    GOOGLE_SHEETS_SCOPE,
    GOOGLE_DRIVE_METADATA_SCOPE,
  ]);

  const files: GoogleSpreadsheetListItem[] = [];
  let nextPageToken: string | null = null;

  do {
    const payload = await googleDriveRequest(accessToken, "/files", {
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: "nextPageToken,files(id,name,modifiedTime,owners(displayName,emailAddress))",
      orderBy: "modifiedTime desc,name_natural",
      pageSize: "100",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      ...(nextPageToken ? { pageToken: nextPageToken } : {}),
    });

    const root = isRecord(payload) ? payload : {};
    const batch = Array.isArray(root.files) ? root.files : [];

    for (const item of batch) {
      const file = isRecord(item) ? item : {};
      const owners = Array.isArray(file.owners) ? file.owners : [];
      const firstOwner = owners.find((owner) => isRecord(owner));

      const fileId = nonEmptyString(file.id);
      if (!fileId) continue;

      files.push({
        id: fileId,
        title: nonEmptyString(file.name),
        modifiedTime: nonEmptyString(file.modifiedTime),
        ownerEmail: isRecord(firstOwner) ? nonEmptyString(firstOwner.emailAddress) : null,
        ownerName: isRecord(firstOwner) ? nonEmptyString(firstOwner.displayName) : null,
      });
    }

    nextPageToken = nonEmptyString(root.nextPageToken);
  } while (nextPageToken);

  return files;
}

export async function fetchGoogleSpreadsheetCatalog(config: GoogleSheetsConfigInput) {
  const parsedConfig = resolveGoogleSheetsCatalogConfig(config);

  if (!parsedConfig) {
    throw new Error("Google Sheets configuration is incomplete.");
  }

  const accessToken = await getGoogleAccessToken(parsedConfig, [
    GOOGLE_SHEETS_SCOPE,
    GOOGLE_DRIVE_METADATA_SCOPE,
  ]);
  const payload = await googleSheetsRequest(
    accessToken,
    `/spreadsheets/${encodeURIComponent(parsedConfig.spreadsheetId)}`,
    undefined,
    {
      fields: "spreadsheetId,properties.title,sheets.properties(sheetId,title,index)",
    },
  );

  const root = isRecord(payload) ? payload : {};
  const sheets = Array.isArray(root.sheets) ? root.sheets : [];

  return {
    spreadsheetId: parsedConfig.spreadsheetId,
    title: nonEmptyString(isRecord(root.properties) ? root.properties.title : null),
    sheets: sheets.map((sheet) => {
      const properties = isRecord(sheet) && isRecord(sheet.properties) ? sheet.properties : {};
      return {
        id: typeof properties.sheetId === "number" ? properties.sheetId : null,
        title: nonEmptyString(properties.title),
        index: typeof properties.index === "number" ? properties.index : null,
      };
    }),
  } satisfies GoogleSpreadsheetCatalog;
}

async function ensureSheetHeader(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  header: string[],
) {
  const currentHeaderPayload = await googleSheetsRequest(
    accessToken,
    `/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(buildSheetRange(sheetName, "A1:Z1"))}`,
  );

  const root = isRecord(currentHeaderPayload) ? currentHeaderPayload : {};
  const values = Array.isArray(root.values) ? root.values : [];

  if (values.length > 0) return;

  await googleSheetsRequest(
    accessToken,
    `/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(buildSheetRange(sheetName, "A1"))}`,
    {
      method: "PUT",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values: [header],
      }),
    },
    {
      valueInputOption: "RAW",
    },
  );
}

export async function appendGoogleSheetsRow(
  config: GoogleSheetsConfigInput,
  header: string[],
  row: Array<string | number | boolean | null | undefined>,
) {
  const parsedConfig = resolveGoogleSheetsRuntimeConfig(config);
  if (!parsedConfig) {
    return { skipped: true, reason: "google_sheets_not_configured" } as const;
  }

  const accessToken = await getGoogleAccessToken(parsedConfig, [
    GOOGLE_SHEETS_SCOPE,
    GOOGLE_DRIVE_METADATA_SCOPE,
  ]);

  await ensureSheetHeader(
    accessToken,
    parsedConfig.spreadsheetId,
    parsedConfig.sheetName,
    header,
  );

  await googleSheetsRequest(
    accessToken,
    `/spreadsheets/${encodeURIComponent(parsedConfig.spreadsheetId)}/values/${encodeURIComponent(buildSheetRange(parsedConfig.sheetName))}:append`,
    {
      method: "POST",
      body: JSON.stringify({
        majorDimension: "ROWS",
        values: [
          row.map((value) => {
            if (value === null || value === undefined) return "";
            if (typeof value === "boolean") return value ? "true" : "false";
            return String(value);
          }),
        ],
      }),
    },
    {
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
    },
  );

  return {
    skipped: false,
    spreadsheetId: parsedConfig.spreadsheetId,
    sheetName: parsedConfig.sheetName,
  } as const;
}

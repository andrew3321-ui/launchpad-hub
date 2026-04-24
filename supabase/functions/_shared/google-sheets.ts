type JsonRecord = Record<string, unknown>;

export interface GoogleSheetsConfigInput {
  enabled?: boolean | null;
  serviceAccountEmail?: string | null;
  privateKey?: string | null;
  spreadsheetId?: string | null;
  sheetName?: string | null;
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

const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

async function getGoogleSheetsAccessToken(
  serviceAccountEmail: string,
  privateKey: string,
) {
  const assertion = await signJwt(serviceAccountEmail, privateKey, [GOOGLE_SHEETS_SCOPE]);
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
  let payload: unknown = {};

  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { rawText };
  }

  if (!response.ok) {
    throw new Error(`Google OAuth ${response.status}: ${rawText}`);
  }

  const accessToken = nonEmptyString(isRecord(payload) ? payload.access_token : null);
  if (!accessToken) {
    throw new Error("Google OAuth did not return an access token.");
  }

  return accessToken;
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
  let payload: unknown = {};

  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { rawText };
  }

  if (!response.ok) {
    throw new Error(`Google Sheets ${response.status}: ${rawText}`);
  }

  return payload;
}

function buildSheetRange(sheetName: string, cells = "A:Z") {
  const escapedSheetName = sheetName.replace(/'/g, "''");
  return `'${escapedSheetName}'!${cells}`;
}

export function parseGoogleSheetsConfig(config: GoogleSheetsConfigInput) {
  const serviceAccountEmail = nonEmptyString(config.serviceAccountEmail);
  const privateKey = nonEmptyString(config.privateKey);
  const spreadsheetId = nonEmptyString(config.spreadsheetId);
  const sheetName = nonEmptyString(config.sheetName);
  const enabled = Boolean(config.enabled);

  if (!enabled || !serviceAccountEmail || !privateKey || !spreadsheetId || !sheetName) {
    return null;
  }

  return {
    enabled,
    serviceAccountEmail,
    privateKey,
    spreadsheetId,
    sheetName,
  };
}

export async function fetchGoogleSpreadsheetCatalog(config: GoogleSheetsConfigInput) {
  const parsedConfig = parseGoogleSheetsConfig({
    ...config,
    enabled: true,
  });

  if (!parsedConfig) {
    throw new Error("Google Sheets configuration is incomplete.");
  }

  const accessToken = await getGoogleSheetsAccessToken(
    parsedConfig.serviceAccountEmail,
    parsedConfig.privateKey,
  );
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
  const parsedConfig = parseGoogleSheetsConfig(config);
  if (!parsedConfig) {
    return { skipped: true, reason: "google_sheets_not_configured" } as const;
  }

  const accessToken = await getGoogleSheetsAccessToken(
    parsedConfig.serviceAccountEmail,
    parsedConfig.privateKey,
  );

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

import type { SupabaseConnectionConfig } from "@/integrations/supabase/client";

const MANAGEMENT_API_URL = "https://api.supabase.com/v1";

export interface SupabaseManagementProject {
  id: string;
  name: string;
  ref: string;
  region: string;
  status: string;
}

interface SupabaseApiKey {
  api_key: string;
  id?: string;
  name?: string;
  type?: string;
}

async function parseResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

async function managementRequest<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${MANAGEMENT_API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: token,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await parseResponse(response);
    const errorMessage =
      typeof errorBody === "object" && errorBody !== null && "message" in errorBody
        ? String(errorBody.message)
        : "Falha ao consultar a API de gerenciamento do Supabase.";
    throw new Error(errorMessage);
  }

  return parseResponse(response) as Promise<T>;
}

export async function listSupabaseProjects(token: string) {
  return managementRequest<SupabaseManagementProject[]>("/projects", token);
}

export async function getSupabaseProjectApiKeys(token: string, projectRef: string) {
  return managementRequest<SupabaseApiKey[]>(`/projects/${projectRef}/api-keys`, token);
}

export async function buildSupabaseRuntimeConnection(
  token: string,
  projectRef: string,
  projectName?: string,
): Promise<Omit<SupabaseConnectionConfig, "source" | "connectedAt">> {
  const apiKeys = await getSupabaseProjectApiKeys(token, projectRef);
  const publishableKey =
    apiKeys.find((key) => key.type === "publishable")?.api_key ||
    apiKeys.find((key) => key.id === "anon" || key.name === "anon")?.api_key;

  if (!publishableKey) {
    throw new Error("Nao foi possivel localizar uma publishable key ou anon key para esse projeto.");
  }

  return {
    projectRef,
    projectName: projectName || projectRef,
    url: `https://${projectRef}.supabase.co`,
    publishableKey,
  };
}

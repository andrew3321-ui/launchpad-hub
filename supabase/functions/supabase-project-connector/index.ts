const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MANAGEMENT_API_URL = "https://api.supabase.com/v1";

interface ConnectorRequest {
  action: "list-projects" | "resolve-project";
  token: string;
  projectRef?: string;
}

interface ManagementProject {
  id: string;
  name: string;
  ref: string;
  region: string;
  status: string;
}

interface ManagementApiKey {
  api_key: string;
  id?: string;
  name?: string;
  type?: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
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
    const message =
      typeof errorBody === "object" && errorBody !== null && "message" in errorBody
        ? String(errorBody.message)
        : "Falha ao consultar a API de gerenciamento do Supabase.";
    throw new Error(message);
  }

  return parseResponse(response) as Promise<T>;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: ConnectorRequest;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (!body.token?.trim()) {
    return jsonResponse({ error: "token is required" }, 400);
  }

  try {
    if (body.action === "list-projects") {
      const projects = await managementRequest<ManagementProject[]>("/projects", body.token.trim());
      return jsonResponse({ projects });
    }

    if (body.action === "resolve-project") {
      if (!body.projectRef?.trim()) {
        return jsonResponse({ error: "projectRef is required for resolve-project" }, 400);
      }

      const [projects, apiKeys] = await Promise.all([
        managementRequest<ManagementProject[]>("/projects", body.token.trim()),
        managementRequest<ManagementApiKey[]>(`/projects/${body.projectRef.trim()}/api-keys`, body.token.trim()),
      ]);

      const selectedProject = projects.find((project) => project.ref === body.projectRef);
      const publishableKey =
        apiKeys.find((key) => key.type === "publishable")?.api_key ||
        apiKeys.find((key) => key.id === "anon" || key.name === "anon")?.api_key;

      if (!selectedProject) {
        return jsonResponse({ error: "Project not found for this token" }, 404);
      }

      if (!publishableKey) {
        return jsonResponse({ error: "No publishable or anon key available for this project" }, 422);
      }

      return jsonResponse({
        project: selectedProject,
        connection: {
          projectRef: selectedProject.ref,
          projectName: selectedProject.name,
          url: `https://${selectedProject.ref}.supabase.co`,
          publishableKey,
        },
      });
    }

    return jsonResponse({ error: "Unsupported action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected connector error";
    return jsonResponse({ error: message }, 500);
  }
});

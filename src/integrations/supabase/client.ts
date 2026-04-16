import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const RUNTIME_CONNECTION_STORAGE_KEY = "launch-hub.supabase-runtime-connection";

export interface SupabaseConnectionConfig {
  projectRef: string;
  projectName: string;
  url: string;
  publishableKey: string;
  source: "embedded" | "runtime";
  connectedAt: string | null;
}

const embeddedConfig: SupabaseConnectionConfig = {
  projectRef: import.meta.env.VITE_SUPABASE_PROJECT_ID || extractProjectRef(import.meta.env.VITE_SUPABASE_URL),
  projectName: "Projeto embutido",
  url: import.meta.env.VITE_SUPABASE_URL,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  source: "embedded",
  connectedAt: null,
};

let activeConfig = loadInitialConfig();
let activeClient = createBrowserClient(activeConfig);
const listeners = new Set<(config: SupabaseConnectionConfig) => void>();

function extractProjectRef(url?: string) {
  if (!url) return "";

  try {
    const { hostname } = new URL(url);
    return hostname.split(".")[0] || "";
  } catch {
    return "";
  }
}

function createBrowserClient(config: SupabaseConnectionConfig) {
  return createClient<Database>(config.url, config.publishableKey, {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

function loadInitialConfig(): SupabaseConnectionConfig {
  const storedValue = localStorage.getItem(RUNTIME_CONNECTION_STORAGE_KEY);
  if (!storedValue) return embeddedConfig;

  try {
    const parsed = JSON.parse(storedValue) as Partial<SupabaseConnectionConfig>;
    if (!parsed.url || !parsed.publishableKey || !parsed.projectRef) {
      return embeddedConfig;
    }

    return {
      projectRef: parsed.projectRef,
      projectName: parsed.projectName || parsed.projectRef,
      url: parsed.url,
      publishableKey: parsed.publishableKey,
      source: "runtime",
      connectedAt: parsed.connectedAt || new Date().toISOString(),
    };
  } catch {
    return embeddedConfig;
  }
}

function notifyListeners() {
  for (const listener of listeners) {
    listener(activeConfig);
  }
}

export function getSupabaseConnectionConfig() {
  return activeConfig;
}

export function getEmbeddedSupabaseConnectionConfig() {
  return embeddedConfig;
}

export function hasRuntimeSupabaseConnection() {
  return activeConfig.source === "runtime";
}

export function setRuntimeSupabaseConnection(
  connection: Omit<SupabaseConnectionConfig, "source" | "connectedAt">,
) {
  activeConfig = {
    ...connection,
    source: "runtime",
    connectedAt: new Date().toISOString(),
  };
  localStorage.setItem(RUNTIME_CONNECTION_STORAGE_KEY, JSON.stringify(activeConfig));
  activeClient = createBrowserClient(activeConfig);
  notifyListeners();
}

export function clearRuntimeSupabaseConnection() {
  localStorage.removeItem(RUNTIME_CONNECTION_STORAGE_KEY);
  activeConfig = embeddedConfig;
  activeClient = createBrowserClient(activeConfig);
  notifyListeners();
}

export function subscribeToSupabaseConnection(
  listener: (config: SupabaseConnectionConfig) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const supabase = new Proxy({} as SupabaseClient<Database>, {
  get(_target, property) {
    const value = activeClient[property as keyof SupabaseClient<Database>];
    return typeof value === "function" ? value.bind(activeClient) : value;
  },
});

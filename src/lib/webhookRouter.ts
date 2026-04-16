import { getSupabaseConnectionConfig } from "@/integrations/supabase/client";

export const inboundWebhookSources = [
  {
    key: "activecampaign",
    label: "ActiveCampaign",
    hint: "Use a webhook de contato no ActiveCampaign apontando para esta URL.",
  },
  {
    key: "uchat",
    label: "UChat",
    hint: "Use um External Request ou webhook do fluxo do UChat apontando para esta URL.",
  },
  {
    key: "manychat",
    label: "ManyChat",
    hint: "Use Dev Tools > External Request no ManyChat para enviar o lead ao Launch Hub.",
  },
  {
    key: "typebot",
    label: "Typebot",
    hint: "Use um bloco HTTP Request no Typebot para enviar o resultado ao Launch Hub.",
  },
  {
    key: "sendflow",
    label: "Sendflow",
    hint: "Crie um webhook/API no Sendflow apontando para esta URL.",
  },
] as const;

export type InboundWebhookSource = (typeof inboundWebhookSources)[number]["key"];

interface LaunchWebhookTarget {
  id: string;
  slug: string | null;
  webhook_secret?: string | null;
}

export function buildLaunchWebhookUrl(
  launch: LaunchWebhookTarget,
  source: InboundWebhookSource,
) {
  const config = getSupabaseConnectionConfig();
  const launchSlug = launch.slug || launch.id;

  if (!config.url || !launchSlug || !launch.webhook_secret) {
    return "";
  }

  const url = new URL(`${config.url}/functions/v1/launch-webhook-router`);
  url.searchParams.set("launchSlug", launchSlug);
  url.searchParams.set("source", source);
  url.searchParams.set("token", launch.webhook_secret);
  return url.toString();
}

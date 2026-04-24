import { getSupabaseConnectionConfig } from "@/integrations/supabase/client";

export const inboundWebhookSources = [
  {
    key: "activecampaign",
    label: "ActiveCampaign",
    hint: "Use a webhook de contato no ActiveCampaign apontando para esta URL do expert.",
  },
  {
    key: "uchat",
    label: "UChat",
    hint: "Use um External Request ou webhook do fluxo do UChat para verificar e tratar contatos sem reenviar ao subflow de boas-vindas.",
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
    key: "tally",
    label: "Tally",
    hint: "Configure o webhook de resposta do Tally para enviar a pesquisa concluida ao Launch Hub.",
  },
  {
    key: "sendflow",
    label: "Sendflow",
    hint: "Crie um webhook/API no Sendflow apontando para esta URL para disparar o subflow padrao de boas-vindas no UChat.",
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
  const expertSlug = launch.slug || launch.id;

  if (!config.url || !expertSlug || !launch.webhook_secret) {
    return "";
  }

  const url = new URL(`${config.url}/functions/v1/launch-webhook-router`);
  url.searchParams.set("expertSlug", expertSlug);
  url.searchParams.set("source", source);
  url.searchParams.set("token", launch.webhook_secret);
  return url.toString();
}

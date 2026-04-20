import { useCallback, useEffect, useMemo, useState } from "react";
import type { Json } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLaunch } from "@/contexts/LaunchContext";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  buildLaunchWebhookUrl,
  inboundWebhookSources,
} from "@/lib/webhookRouter";
import { Copy, Loader2, Radio, Webhook } from "lucide-react";
import {
  ActiveCampaignSourceTagBindings,
  type ActiveCampaignTagOption,
} from "@/components/launches/ActiveCampaignSourceTagBindings";
import {
  NamedTagsEditor,
  type NamedTagDraft,
} from "@/components/launches/NamedTagsEditor";
import {
  UChatWorkspacesEditor,
  type UChatWorkspaceDraft,
} from "@/components/launches/UChatWorkspacesEditor";

interface LaunchSettingsRow {
  id: string;
  name: string;
  project_id: string | null;
  slug: string | null;
  webhook_secret: string;
  ac_api_url: string | null;
  ac_api_key: string | null;
  ac_default_list_id: string | null;
  ac_named_tags: unknown;
}

interface SourcesDraft {
  acApiUrl: string;
  acApiKey: string;
  acListId: string;
  acNamedTags: NamedTagDraft[];
  uchatWorkspaces: UChatWorkspaceDraft[];
}

interface LaunchSourcesPayload {
  launch: LaunchSettingsRow;
  uchat_workspaces: Array<Record<string, unknown>>;
}

interface ActiveCampaignCatalogResponse {
  tags: ActiveCampaignTagOption[];
  loadedAt?: string;
}

const MANAGED_SOURCE_ALIASES = [
  {
    alias: "typebot",
    label: "Typebot",
    helper: "Tags aplicadas quando o contato entrar pelo webhook do Typebot.",
  },
  {
    alias: "manychat",
    label: "ManyChat",
    helper: "Tags aplicadas quando o contato entrar pelo webhook do ManyChat.",
  },
] as const;

function buildSourcesDraftKey(launchId: string) {
  return `launchhub:sources-draft:${launchId}`;
}

function parseSourcesDraft(raw: string | null): SourcesDraft | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SourcesDraft>;
    return {
      acApiUrl: typeof parsed.acApiUrl === "string" ? parsed.acApiUrl : "",
      acApiKey: typeof parsed.acApiKey === "string" ? parsed.acApiKey : "",
      acListId: typeof parsed.acListId === "string" ? parsed.acListId : "",
      acNamedTags: Array.isArray(parsed.acNamedTags) ? (parsed.acNamedTags as NamedTagDraft[]) : [],
      uchatWorkspaces: Array.isArray(parsed.uchatWorkspaces)
        ? (parsed.uchatWorkspaces as UChatWorkspaceDraft[])
        : [],
    };
  } catch {
    return null;
  }
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function resolveAliasTagIds(
  tags: NamedTagDraft[],
  alias: string,
  availableTags: ActiveCampaignTagOption[],
) {
  const normalizedAlias = normalizeKey(alias);

  return uniqueStrings(
    tags
      .filter((tag) => normalizeKey(tag.alias) === normalizedAlias)
      .map((tag) => {
        const matchedTag = availableTags.find(
          (option) =>
            option.id === tag.tag ||
            normalizeKey(option.name) === normalizeKey(tag.tag),
        );
        return matchedTag?.id ?? tag.tag;
      }),
  );
}

function replaceAliasTags(tags: NamedTagDraft[], alias: string, nextTagIds: string[]) {
  const normalizedAlias = normalizeKey(alias);
  const remainingTags = tags.filter((tag) => normalizeKey(tag.alias) !== normalizedAlias);

  return [
    ...remainingTags,
    ...uniqueStrings(nextTagIds).map((tagId) => ({
      alias,
      tag: tagId,
    })),
  ];
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <Badge variant={connected ? "default" : "secondary"}>
      {connected ? "Configurado" : "Nao configurado"}
    </Badge>
  );
}

export default function Sources() {
  const { activeLaunch } = useLaunch();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"active" | "uchat" | null>(null);
  const [hydratedLaunchId, setHydratedLaunchId] = useState<string | null>(null);

  const [launchSettings, setLaunchSettings] = useState<LaunchSettingsRow | null>(null);
  const [acApiUrl, setAcApiUrl] = useState("");
  const [acApiKey, setAcApiKey] = useState("");
  const [acListId, setAcListId] = useState("");
  const [acNamedTags, setAcNamedTags] = useState<NamedTagDraft[]>([]);
  const [uchatWorkspaces, setUchatWorkspaces] = useState<UChatWorkspaceDraft[]>([]);
  const [activeCampaignTags, setActiveCampaignTags] = useState<ActiveCampaignTagOption[]>([]);
  const [loadingActiveCampaignTags, setLoadingActiveCampaignTags] = useState(false);
  const [activeCampaignTagsLoadedAt, setActiveCampaignTagsLoadedAt] = useState<string | null>(null);

  const managedAliasKeys = useMemo(
    () => MANAGED_SOURCE_ALIASES.map((binding) => normalizeKey(binding.alias)),
    [],
  );

  const managedSourceBindings = useMemo(
    () =>
      MANAGED_SOURCE_ALIASES.map((binding) => ({
        ...binding,
        selectedTagIds: resolveAliasTagIds(acNamedTags, binding.alias, activeCampaignTags),
      })),
    [acNamedTags, activeCampaignTags],
  );

  const advancedNamedTags = useMemo(
    () => acNamedTags.filter((tag) => !managedAliasKeys.includes(normalizeKey(tag.alias))),
    [acNamedTags, managedAliasKeys],
  );

  const loadActiveCampaignCatalog = useCallback(
    async (options?: {
      apiUrl?: string;
      apiKey?: string;
      silent?: boolean;
    }) => {
      const trimmedApiUrl = (options?.apiUrl ?? acApiUrl).trim();
      const trimmedApiKey = (options?.apiKey ?? acApiKey).trim();

      if (!trimmedApiUrl || !trimmedApiKey) {
        setActiveCampaignTags([]);
        setActiveCampaignTagsLoadedAt(null);

        if (!options?.silent) {
          toast({
            title: "Preencha as credenciais do ActiveCampaign",
            description: "Informe a API URL e a API Key para carregar as tags da conta.",
            variant: "destructive",
          });
        }
        return;
      }

      setLoadingActiveCampaignTags(true);

      const { data, error } = await supabase.functions.invoke("activecampaign-catalog", {
        body: {
          apiUrl: trimmedApiUrl,
          apiKey: trimmedApiKey,
        },
      });

      setLoadingActiveCampaignTags(false);

      const typedData = (data ?? null) as ActiveCampaignCatalogResponse | null;
      if (error || !typedData?.tags) {
        if (!options?.silent) {
          toast({
            title: "Erro ao carregar tags do ActiveCampaign",
            description:
              error?.message ||
              "Nao foi possivel consultar as tags da conta com essas credenciais.",
            variant: "destructive",
          });
        }
        return;
      }

      setActiveCampaignTags(typedData.tags);
      setActiveCampaignTagsLoadedAt(typedData.loadedAt ?? new Date().toISOString());

      if (!options?.silent) {
        toast({
          title: "Tags carregadas",
          description: `${typedData.tags.length} tag(s) do ActiveCampaign disponiveis para mapeamento.`,
        });
      }
    },
    [acApiKey, acApiUrl, toast],
  );

  useEffect(() => {
    const load = async () => {
      if (!activeLaunch) {
        setLaunchSettings(null);
        setAcApiUrl("");
        setAcApiKey("");
        setAcListId("");
        setAcNamedTags([]);
        setUchatWorkspaces([]);
        setActiveCampaignTags([]);
        setActiveCampaignTagsLoadedAt(null);
        setHydratedLaunchId(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setHydratedLaunchId(null);

      const [
        { data: sourcesPayload, error: sourcesError },
      ] = await Promise.all([
        supabase.rpc("get_launch_sources", { target_launch_id: activeLaunch.id }),
      ]);

      const parsedPayload = (sourcesPayload ?? null) as unknown as LaunchSourcesPayload | null;
      const launchData = parsedPayload?.launch ?? null;
      const workspaceData = parsedPayload?.uchat_workspaces ?? [];

      if (sourcesError || !launchData) {
        toast({
          title: "Erro ao carregar as fontes",
          description:
            sourcesError?.message ||
            "Nao foi possivel carregar as configuracoes do lancamento.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const typedLaunch = launchData as LaunchSettingsRow;
      const remoteUchatWorkspaces = ((workspaceData || []) as Array<Record<string, unknown>>).map(
        (workspace) => ({
          id: typeof workspace.id === "string" ? workspace.id : undefined,
          workspace_name:
            typeof workspace.workspace_name === "string" ? workspace.workspace_name : "",
          workspace_id: typeof workspace.workspace_id === "string" ? workspace.workspace_id : "",
          api_token: typeof workspace.api_token === "string" ? workspace.api_token : "",
          welcome_subflow_ns:
            typeof workspace.welcome_subflow_ns === "string"
              ? workspace.welcome_subflow_ns
              : "",
          default_tag_name:
            typeof workspace.default_tag_name === "string" ? workspace.default_tag_name : "",
        }),
      );
      const draft = parseSourcesDraft(localStorage.getItem(buildSourcesDraftKey(activeLaunch.id)));

      setLaunchSettings(typedLaunch);
      setAcApiUrl(draft?.acApiUrl ?? typedLaunch.ac_api_url ?? "");
      setAcApiKey(draft?.acApiKey ?? typedLaunch.ac_api_key ?? "");
      setAcListId(draft?.acListId ?? typedLaunch.ac_default_list_id ?? "");
      setAcNamedTags(
        draft?.acNamedTags ??
          (Array.isArray(typedLaunch.ac_named_tags)
            ? (typedLaunch.ac_named_tags as NamedTagDraft[])
            : []),
      );
      setUchatWorkspaces(draft?.uchatWorkspaces ?? remoteUchatWorkspaces);
      setHydratedLaunchId(activeLaunch.id);
      setLoading(false);
    };

    void load();
  }, [activeLaunch, toast]);

  useEffect(() => {
    if (!activeLaunch || loading || hydratedLaunchId !== activeLaunch.id) return;

    const savedApiUrl = launchSettings?.ac_api_url?.trim() || "";
    const savedApiKey = launchSettings?.ac_api_key?.trim() || "";

    if (!savedApiUrl || !savedApiKey) {
      setActiveCampaignTags([]);
      setActiveCampaignTagsLoadedAt(null);
      return;
    }

    if (activeCampaignTags.length > 0 || loadingActiveCampaignTags) return;

    void loadActiveCampaignCatalog({
      apiUrl: savedApiUrl,
      apiKey: savedApiKey,
      silent: true,
    });
  }, [
    activeCampaignTags.length,
    activeLaunch,
    hydratedLaunchId,
    launchSettings?.ac_api_key,
    launchSettings?.ac_api_url,
    loadActiveCampaignCatalog,
    loadingActiveCampaignTags,
    loading,
  ]);

  useEffect(() => {
    if (!activeLaunch || loading || hydratedLaunchId !== activeLaunch.id) return;

    localStorage.setItem(
      buildSourcesDraftKey(activeLaunch.id),
      JSON.stringify({
        acApiUrl,
        acApiKey,
        acListId,
        acNamedTags,
        uchatWorkspaces,
      } satisfies SourcesDraft),
    );
  }, [
    activeLaunch,
    loading,
    hydratedLaunchId,
    acApiUrl,
    acApiKey,
    acListId,
    acNamedTags,
    uchatWorkspaces,
  ]);

  const activeConnected = useMemo(
    () => Boolean(acApiUrl.trim() && acApiKey.trim()),
    [acApiKey, acApiUrl],
  );
  const uchatConnected = useMemo(
    () =>
      uchatWorkspaces.some(
        (workspace) => workspace.workspace_id.trim() && workspace.api_token.trim(),
      ),
    [uchatWorkspaces],
  );

  const updateManagedSourceTags = (alias: string, tagId: string, checked: boolean) => {
    setAcNamedTags((currentTags) => {
      const selectedTagIds = resolveAliasTagIds(currentTags, alias, activeCampaignTags);
      const nextTagIds = checked
        ? [...selectedTagIds, tagId]
        : selectedTagIds.filter((currentTagId) => currentTagId !== tagId);

      return replaceAliasTags(currentTags, alias, nextTagIds);
    });
  };

  const updateAdvancedNamedTags = (nextAdvancedTags: NamedTagDraft[]) => {
    setAcNamedTags((currentTags) => {
      const managedTags = currentTags.filter((tag) =>
        managedAliasKeys.includes(normalizeKey(tag.alias)),
      );
      return [...managedTags, ...nextAdvancedTags];
    });
  };

  const saveActiveCampaign = async () => {
    if (!activeLaunch) return;

    setSaving("active");
    const { error, data } = await supabase
      .rpc("update_launch_activecampaign_settings", {
        target_launch_id: activeLaunch.id,
        next_api_url: acApiUrl || null,
        next_api_key: acApiKey || null,
        next_default_list_id: acListId || null,
        next_named_tags: acNamedTags as unknown as Json,
      });

    setSaving(null);

    if (error || !data) {
      toast({
        title: "Erro ao salvar ActiveCampaign",
        description: error?.message || "O backend nao confirmou a atualizacao.",
        variant: "destructive",
      });
      return;
    }

    setLaunchSettings(data as unknown as LaunchSettingsRow);
    setHydratedLaunchId(activeLaunch.id);
    void loadActiveCampaignCatalog({
      apiUrl: acApiUrl,
      apiKey: acApiKey,
      silent: true,
    });
    toast({
      title: "ActiveCampaign salvo",
      description: "As credenciais de saida para o ActiveCampaign foram atualizadas.",
    });
  };

  const saveUchat = async () => {
    if (!activeLaunch) return;

    setSaving("uchat");

    const rows = uchatWorkspaces
      .filter((workspace) => workspace.workspace_id.trim() && workspace.api_token.trim())
      .map((workspace) => ({
        workspace_name: workspace.workspace_name || "Workspace UChat",
        workspace_id: workspace.workspace_id || null,
        bot_id: workspace.workspace_id || null,
        api_token: workspace.api_token,
        welcome_subflow_ns: workspace.welcome_subflow_ns || null,
        default_tag_name: workspace.default_tag_name || null,
      }));

    const { error, data } = await supabase.rpc("replace_launch_uchat_workspaces", {
      target_launch_id: activeLaunch.id,
      next_workspaces: rows as unknown as Json,
    });

    if (error) {
      setSaving(null);
      toast({
        title: "Erro ao salvar UChat",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    const savedWorkspaces = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    setUchatWorkspaces(
      savedWorkspaces.map((workspace) => ({
        id: typeof workspace.id === "string" ? workspace.id : undefined,
        workspace_name: typeof workspace.workspace_name === "string" ? workspace.workspace_name : "",
        workspace_id: typeof workspace.workspace_id === "string" ? workspace.workspace_id : "",
        api_token: typeof workspace.api_token === "string" ? workspace.api_token : "",
        welcome_subflow_ns:
          typeof workspace.welcome_subflow_ns === "string" ? workspace.welcome_subflow_ns : "",
        default_tag_name:
          typeof workspace.default_tag_name === "string" ? workspace.default_tag_name : "",
      })),
    );

    setSaving(null);
    setHydratedLaunchId(activeLaunch.id);
    toast({
      title: "UChat salvo",
      description: "Os workspaces e as acoes de retorno do UChat foram atualizados.",
    });
  };

  const copyText = async (value: string, label: string) => {
    if (!value) {
      toast({
        title: "Nada para copiar",
        description: `O ${label.toLowerCase()} ainda nao esta disponivel.`,
        variant: "destructive",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copiado`, description: "Cole isso na plataforma de origem." });
    } catch (error) {
      toast({
        title: "Falha ao copiar",
        description:
          error instanceof Error ? error.message : "Nao foi possivel copiar agora.",
        variant: "destructive",
      });
    }
  };

  if (!activeLaunch) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Radio className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Fontes</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Selecione um lancamento</CardTitle>
            <CardDescription>
              Escolha um lancamento na barra lateral para configurar webhooks e as saidas para
              ActiveCampaign e UChat.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Radio className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Fontes</h1>
            <p className="text-sm text-muted-foreground">
              O Launch Hub agora recebe sinais por webhook e so usa ActiveCampaign e UChat
              para devolver os contatos tratados do lancamento{" "}
              <span className="font-medium text-foreground">{activeLaunch.name}</span>.
            </p>
          </div>
        </div>
        <Badge variant="outline">{launchSettings?.slug || activeLaunch.slug || "sem-slug"}</Badge>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-6">
          <Webhook className="mt-0.5 h-5 w-5 text-primary" />
          <div className="space-y-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Modelo webhook-first por lancamento</p>
            <p>
              Entradas: ActiveCampaign, UChat, ManyChat, Typebot e Sendflow.
            </p>
            <p>Saidas: ActiveCampaign e UChat, apos verificacao e tratamento da base canonica.</p>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-xl">ActiveCampaign</CardTitle>
                <CardDescription>
                  Credenciais de saida para receber os contatos tratados e aplicar tags/lista.
                </CardDescription>
              </div>
              <ConnectionBadge connected={activeConnected} />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ac-url">API URL</Label>
                <Input
                  id="ac-url"
                  value={acApiUrl}
                  onChange={(event) => setAcApiUrl(event.target.value)}
                  placeholder="https://sua-conta.api-us1.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ac-key">API Key</Label>
                <Input
                  id="ac-key"
                  type="password"
                  value={acApiKey}
                  onChange={(event) => setAcApiKey(event.target.value)}
                  placeholder="Cole a chave da API"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ac-list-id">Lista padrao</Label>
                <Input
                  id="ac-list-id"
                  value={acListId}
                  onChange={(event) => setAcListId(event.target.value)}
                  placeholder="Ex: 1"
                />
              </div>
              <div className="space-y-2">
                <Label>Tags nomeadas</Label>
                <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">Tags sincronizadas do ActiveCampaign</p>
                      <p className="text-sm text-muted-foreground">
                        Carregue as tags reais da conta e escolha quais devem ser aplicadas quando o
                        webhook vier do Typebot ou do ManyChat.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void loadActiveCampaignCatalog()}
                      disabled={saving !== null || loadingActiveCampaignTags || !activeConnected}
                    >
                      {loadingActiveCampaignTags && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Carregar tags do ActiveCampaign
                    </Button>
                  </div>

                  {activeCampaignTagsLoadedAt && (
                    <p className="text-xs text-muted-foreground">
                      {activeCampaignTags.length} tag(s) carregada(s) em{" "}
                      {new Date(activeCampaignTagsLoadedAt).toLocaleString("pt-BR")}.
                    </p>
                  )}

                  <ActiveCampaignSourceTagBindings
                    availableTags={activeCampaignTags}
                    bindings={managedSourceBindings}
                    disabled={saving !== null || loadingActiveCampaignTags}
                    onToggleTag={updateManagedSourceTags}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Mapeamentos avancados</p>
                  <p className="text-sm text-muted-foreground">
                    Use esta area para aliases extras, estados personalizados ou qualquer regra que
                    nao seja o roteamento padrao de Typebot e ManyChat.
                  </p>
                  <NamedTagsEditor
                    tags={advancedNamedTags}
                    onChange={updateAdvancedNamedTags}
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => void saveActiveCampaign()} disabled={saving !== null}>
                {saving === "active" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar ActiveCampaign
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div className="space-y-1.5">
                <CardTitle className="text-xl">UChat</CardTitle>
                <CardDescription>
                  Workspaces de destino para o retorno ActiveCampaign/Sendflow {"->"} Launch Hub {"->"} UChat,
                  com subflow de boas-vindas e/ou add tag. Eventos vindos do proprio UChat
                  consultam o ActiveCampaign para duplicidade, mas nao retornam ao subflow
                  padrao de boas-vindas.
                </CardDescription>
              </div>
              <ConnectionBadge connected={uchatConnected} />
            </CardHeader>
            <CardContent className="space-y-4">
              <UChatWorkspacesEditor
                workspaces={uchatWorkspaces}
                onChange={setUchatWorkspaces}
              />
            </CardContent>
            <CardFooter className="justify-end">
              <Button onClick={() => void saveUchat()} disabled={saving !== null}>
                {saving === "uchat" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar UChat
              </Button>
            </CardFooter>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="text-xl">Webhooks do lancamento</CardTitle>
              <CardDescription>
                Use estas URLs para ligar os sinais externos ao Launch Hub. Cada webhook ja sai
                protegido pelo segredo do lancamento.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {inboundWebhookSources.map((source) => {
                const webhookUrl = launchSettings
                  ? buildLaunchWebhookUrl(launchSettings, source.key)
                  : "";

                return (
                  <div key={source.key} className="rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{source.label}</p>
                      <Badge variant="outline">{source.key}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{source.hint}</p>
                    <div className="mt-4 space-y-2">
                      <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => void copyText(webhookUrl, `Webhook ${source.label}`)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Copiar webhook
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

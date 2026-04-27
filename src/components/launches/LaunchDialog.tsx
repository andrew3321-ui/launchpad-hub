import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { slugify } from "@/lib/slugify";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { CustomStatesEditor } from "./CustomStatesEditor";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  launchId: string | null;
  onSaved: () => void;
}

interface LaunchMutationResult {
  id: string;
  slug: string | null;
}

export function LaunchDialog({ open, onOpenChange, launchId, onSaved }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [customStates, setCustomStates] = useState<string[]>([
    "cadastrado",
    "boas_vindas_enviado",
    "entrou_grupo",
    "ativo",
  ]);
  const [whatsappLink, setWhatsappLink] = useState("");

  const isEditing = Boolean(launchId);

  useEffect(() => {
    if (!open) return;
    if (!launchId) {
      resetForm();
      return;
    }
    void loadLaunch(launchId);
  }, [open, launchId]);

  const resetForm = () => {
    setName("");
    setSlug("");
    setSlugManual(false);
    setCustomStates(["cadastrado", "boas_vindas_enviado", "entrou_grupo", "ativo"]);
    setWhatsappLink("");
  };

  const loadLaunch = async (id: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("launches")
      .select("name, slug, custom_states, whatsapp_group_link")
      .eq("id", id)
      .single();

    if (error) {
      toast({ title: "Erro ao carregar expert", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    setName(data.name);
    setSlug(data.slug || "");
    setSlugManual(Boolean(data.slug));
    setCustomStates(Array.isArray(data.custom_states) ? (data.custom_states as string[]) : []);
    setWhatsappLink(data.whatsapp_group_link || "");
    setLoading(false);
  };

  const withTimeout = async <T,>(promise: PromiseLike<T>, message: string, timeoutMs = 15000): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });

    try {
      return await Promise.race([Promise.resolve(promise), timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  const buildSlugCandidate = (baseSlug: string, attempt: number) => {
    if (attempt === 0) return baseSlug;
    return `${baseSlug}-${attempt + 1}`;
  };

  const isDuplicateSlugError = (error: { code?: string; message?: string } | null) => {
    if (!error) return false;
    const message = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
    return error.code === "23505" || (message.includes("duplicate") && message.includes("slug"));
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugManual) setSlug(slugify(value));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({
        title: "Nome obrigatório",
        description: "Informe o nome do expert para continuar.",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Sessão indisponivel",
        description: "Sua sessão não foi reconhecida. Atualize a página e entre novamente.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    try {
      const baseSlug = slug.trim() || slugify(name);

      if (!baseSlug) {
        toast({
          title: "Slug inválido",
          description: "Use um nome com letras ou números para gerar o identificador interno do expert.",
          variant: "destructive",
        });
        setSaving(false);
        return;
      }

      if (isEditing) {
        const { error, data } = await withTimeout(
          supabase.rpc("update_launch_metadata", {
            target_launch_id: launchId,
            next_name: name.trim(),
            next_slug: baseSlug,
            next_status: "active",
            next_custom_states: customStates as unknown as Json,
            next_whatsapp_group_link: whatsappLink || null,
          }),
            "O backend demorou demais para responder ao salvar o expert. Tente novamente.",
        );

        if (error || !data) {
          toast({
            title: "Erro ao salvar",
            description: error?.message || "O lancamento não retornou confirmacao do backend.",
            variant: "destructive",
          });
          return;
        }
      } else {
        let createdSlug = baseSlug;
        let slugAdjusted = false;
        let created = false;

        for (let attempt = 0; attempt < 4; attempt += 1) {
          const candidateSlug = buildSlugCandidate(baseSlug, attempt);
          const { error, data } = await withTimeout(
            supabase.rpc("create_launch_metadata", {
              next_name: name.trim(),
              next_slug: candidateSlug,
              next_status: "active",
              next_custom_states: customStates as unknown as Json,
              next_whatsapp_group_link: whatsappLink || null,
            }),
            "O backend demorou demais para responder ao criar o expert. Tente novamente.",
          );

          const createdLaunch = (data ?? null) as unknown as LaunchMutationResult | null;

          if (!error && createdLaunch?.id) {
            createdSlug = createdLaunch.slug || candidateSlug;
            slugAdjusted = createdSlug !== baseSlug;
            created = true;
            break;
          }

          if (!isDuplicateSlugError(error)) {
            toast({
              title: "Erro ao criar",
              description: error?.message || "O backend não confirmou a criação do expert.",
              variant: "destructive",
            });
            return;
          }
        }

        if (!created) {
          toast({
            title: "Slug em uso",
            description: "Não conseguimos reservar um identificador único para esse expert. Tente outro nome ou slug.",
            variant: "destructive",
          });
          return;
        }

        if (slugAdjusted) {
          setSlug(createdSlug);
          setSlugManual(true);
          toast({
            title: "Slug ajustado automaticamente",
            description: `Já existia um expert com esse identificador. Usamos "${createdSlug}" para evitar conflito.`,
          });
        }
      }

      toast({ title: isEditing ? "Expert atualizado!" : "Expert criado!" });
      onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha inesperada ao salvar o expert.";
      console.error("launch save failed", error);
      toast({ title: "Erro no expert", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar expert" : "Novo expert"}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input
                value={name}
                onChange={(event) => handleNameChange(event.target.value)}
                placeholder="Ex: Elza - Maio 2026"
              />
            </div>

            <div className="space-y-2">
              <Label>Slug</Label>
              <Input
                value={slug}
                onChange={(event) => {
                  setSlugManual(true);
                  setSlug(event.target.value);
                }}
                placeholder="auto-gerado-do-nome"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Identificador usado nas URLs e na organizacao interna do expert.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Estados personalizados do lead</Label>
              <CustomStatesEditor states={customStates} onChange={setCustomStates} />
            </div>

            <div className="space-y-2">
              <Label>Link do grupo WhatsApp</Label>
              <Input
                value={whatsappLink}
                onChange={(event) => setWhatsappLink(event.target.value)}
                placeholder="https://chat.whatsapp.com/..."
              />
            </div>

            <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              As credenciais de ActiveCampaign, UChat e Google Sheets ficam em{" "}
              <span className="font-medium text-foreground">Fontes</span>.
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? "Salvar" : "Criar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

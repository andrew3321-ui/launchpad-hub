import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProject } from "@/contexts/ProjectContext";
import { useToast } from "@/hooks/use-toast";
import { slugify } from "@/lib/slugify";
import { withTimeout } from "@/lib/supabaseTimeout";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { CustomStatesEditor } from "./CustomStatesEditor";
import { NamedTagsEditor } from "./NamedTagsEditor";
import { LaunchUChatEditor } from "./LaunchUChatEditor";
import type { Json } from "@/integrations/supabase/types";

interface NamedTag {
  alias: string;
  tag: string;
}

interface LaunchWorkspace {
  workspace_id: string;
  workspace_name: string;
  max_subscribers: number;
  current_count: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  launchId: string | null;
  onSaved: () => void;
}

export function LaunchDialog({ open, onOpenChange, launchId, onSaved }: Props) {
  const { user } = useAuth();
  const { activeProject } = useProject();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);
  const [customStates, setCustomStates] = useState<string[]>([
    "cadastrado", "boas_vindas_enviado", "entrou_grupo", "ativo",
  ]);

  const [acListId, setAcListId] = useState("");
  const [acNamedTags, setAcNamedTags] = useState<NamedTag[]>([]);
  const [acAutomationId, setAcAutomationId] = useState("");

  const [launchWorkspaces, setLaunchWorkspaces] = useState<LaunchWorkspace[]>([]);

  const isEditing = !!launchId;

  useEffect(() => {
    if (!open) return;
    if (!launchId) {
      resetForm();
      return;
    }
    loadLaunch(launchId);
  }, [open, launchId]);

  const resetForm = () => {
    setName("");
    setSlug("");
    setSlugManual(false);
    setCustomStates(["cadastrado", "boas_vindas_enviado", "entrou_grupo", "ativo"]);
    setAcListId("");
    setAcNamedTags([]);
    setAcAutomationId("");
    setLaunchWorkspaces([]);
  };

  const loadLaunch = async (id: string) => {
    setLoading(true);
    try {
      const { data, error } = await withTimeout(
        supabase.from("launches").select("*").eq("id", id).single(),
        10000, "Load launch"
      );
      if (error) {
        console.error("Error loading launch:", error);
        toast({ title: "Erro ao carregar lançamento", description: error.message, variant: "destructive" });
        return;
      }
      if (data) {
        setName(data.name);
        setSlug(data.slug || "");
        setSlugManual(true);
        setCustomStates(Array.isArray(data.custom_states) ? (data.custom_states as string[]) : []);
        setAcListId(data.ac_default_list_id || "");
        setAcNamedTags(Array.isArray(data.ac_named_tags) ? (data.ac_named_tags as unknown as NamedTag[]) : []);
        setAcAutomationId(data.ac_default_automation_id || "");
      }

      const { data: lws, error: lwsError } = await withTimeout(
        supabase.from("launch_uchat_workspaces").select("workspace_id, max_subscribers, current_count").eq("launch_id", id),
        10000, "Load launch workspaces"
      );
      if (lwsError) {
        console.error("Error loading launch workspaces:", lwsError);
      }

      if (lws && lws.length > 0) {
        const wsIds = lws.map((l) => l.workspace_id);
        const { data: wsData } = await withTimeout(
          supabase.from("uchat_workspaces").select("id, workspace_name").in("id", wsIds),
          10000, "Load workspace names"
        );

        const nameMap: Record<string, string> = {};
        wsData?.forEach((w) => { nameMap[w.id] = w.workspace_name; });

        setLaunchWorkspaces(lws.map((l) => ({
          workspace_id: l.workspace_id,
          workspace_name: nameMap[l.workspace_id] || "",
          max_subscribers: l.max_subscribers,
          current_count: l.current_count,
        })));
      } else {
        setLaunchWorkspaces([]);
      }
    } catch (err) {
      console.error("Error in loadLaunch:", err);
      toast({ title: "Erro ao carregar", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManual) setSlug(slugify(val));
  };

  const handleSave = async () => {
    if (!name.trim() || !user || !activeProject) return;
    setSaving(true);

    try {
      const launchData = {
        name: name.trim(),
        slug: slug.trim() || slugify(name),
        custom_states: customStates as unknown as Json,
        project_id: activeProject.id,
        ac_default_list_id: acListId || null,
        ac_named_tags: acNamedTags as unknown as Json,
        ac_default_automation_id: acAutomationId || null,
      };

      let savedId = launchId;

      if (isEditing) {
        const { error } = await withTimeout(
          supabase.from("launches").update(launchData).eq("id", launchId),
          10000, "Update launch"
        );
        if (error) {
          toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
          return;
        }
      } else {
        const { data, error } = await withTimeout(
          supabase.from("launches").insert({ ...launchData, created_by: user.id }).select("id").maybeSingle(),
          10000, "Create launch"
        );
        if (error) {
          toast({ title: "Erro ao criar", description: error.message, variant: "destructive" });
          return;
        }
        savedId = data?.id ?? null;
        if (!savedId) {
          toast({ title: "Erro ao criar", description: "Lançamento não retornou ID.", variant: "destructive" });
          return;
        }
      }

      // Save launch workspaces
      if (savedId) {
        const { error: delError } = await withTimeout(
          supabase.from("launch_uchat_workspaces").delete().eq("launch_id", savedId),
          10000, "Delete old launch workspaces"
        );
        if (delError) {
          console.error("Error deleting launch workspaces:", delError);
        }

        if (launchWorkspaces.length > 0) {
          const rows = launchWorkspaces.map((w) => ({
            launch_id: savedId!,
            workspace_id: w.workspace_id,
            max_subscribers: w.max_subscribers,
            current_count: w.current_count,
          }));
          const { error: insError } = await withTimeout(
            supabase.from("launch_uchat_workspaces").insert(rows),
            10000, "Insert launch workspaces"
          );
          if (insError) {
            toast({ title: "Erro ao salvar workspaces", description: insError.message, variant: "destructive" });
          }
        }
      }

      toast({ title: isEditing ? "Lançamento atualizado!" : "Lançamento criado!" });
      onSaved();
    } catch (err) {
      console.error("Error in handleSave:", err);
      toast({ title: "Erro inesperado", description: String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Atualize as configurações do lançamento." : "Preencha os dados do novo lançamento."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="general" className="mt-2">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="general">Geral</TabsTrigger>
              <TabsTrigger value="states">Estados</TabsTrigger>
              <TabsTrigger value="activecampaign">ActiveCampaign</TabsTrigger>
              <TabsTrigger value="uchat">UChat</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Ex: Lançamento Abril 2026" />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input
                  value={slug}
                  onChange={(e) => { setSlugManual(true); setSlug(e.target.value); }}
                  placeholder="auto-gerado-do-nome"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">Identificador único usado nas URLs de webhook</p>
              </div>
            </TabsContent>

            <TabsContent value="states" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Estados personalizados do lead</Label>
                <p className="text-xs text-muted-foreground">
                  Defina os estados possíveis de um lead neste lançamento.
                </p>
                <CustomStatesEditor states={customStates} onChange={setCustomStates} />
              </div>
            </TabsContent>

            <TabsContent value="activecampaign" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Configurações de uso do ActiveCampaign para este lançamento.
              </p>
              <div className="space-y-2">
                <Label>ID da Lista</Label>
                <Input value={acListId} onChange={(e) => setAcListId(e.target.value)} placeholder="Ex: 1" />
              </div>
              <div className="space-y-2">
                <Label>ID da Automação padrão (opcional)</Label>
                <Input value={acAutomationId} onChange={(e) => setAcAutomationId(e.target.value)} placeholder="Ex: 5" />
              </div>
              <div className="space-y-2">
                <Label>Tags nomeadas</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Defina apelidos internos para tags do ActiveCampaign.
                </p>
                <NamedTagsEditor tags={acNamedTags} onChange={setAcNamedTags} />
              </div>
            </TabsContent>

            <TabsContent value="uchat" className="space-y-4 mt-4">
              {activeProject && (
                <LaunchUChatEditor
                  projectId={activeProject.id}
                  workspaces={launchWorkspaces}
                  onChange={setLaunchWorkspaces}
                />
              )}
            </TabsContent>
          </Tabs>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim() || !activeProject}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? "Salvar" : "Criar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

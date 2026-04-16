import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProject } from "@/contexts/ProjectContext";
import { useToast } from "@/hooks/use-toast";
import { slugify } from "@/lib/slugify";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
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

  // AC config
  const [acListId, setAcListId] = useState("");
  const [acNamedTags, setAcNamedTags] = useState<NamedTag[]>([]);
  const [acAutomationId, setAcAutomationId] = useState("");

  // UChat workspaces
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
    const { data } = await supabase.from("launches").select("*").eq("id", id).single();
    if (data) {
      setName(data.name);
      setSlug(data.slug || "");
      setSlugManual(true);
      setCustomStates(Array.isArray(data.custom_states) ? (data.custom_states as string[]) : []);
      setAcListId(data.ac_default_list_id || "");
      setAcNamedTags(Array.isArray(data.ac_named_tags) ? (data.ac_named_tags as unknown as NamedTag[]) : []);
      setAcAutomationId(data.ac_default_automation_id || "");
    }

    // Load launch workspaces
    const { data: lws } = await supabase
      .from("launch_uchat_workspaces")
      .select("workspace_id, max_subscribers, current_count")
      .eq("launch_id", id);

    if (lws && lws.length > 0) {
      // Get workspace names
      const wsIds = lws.map((l) => l.workspace_id);
      const { data: wsData } = await supabase
        .from("uchat_workspaces")
        .select("id, workspace_name")
        .in("id", wsIds);

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

    setLoading(false);
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManual) setSlug(slugify(val));
  };

  const handleSave = async () => {
    if (!name.trim() || !user || !activeProject) return;
    setSaving(true);

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
      const { error } = await supabase.from("launches").update(launchData).eq("id", launchId);
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("launches")
        .insert({ ...launchData, created_by: user.id })
        .select("id")
        .single();
      if (error) {
        toast({ title: "Erro ao criar", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
      savedId = data.id;
    }

    // Save launch workspaces
    if (savedId) {
      await supabase.from("launch_uchat_workspaces").delete().eq("launch_id", savedId);
      if (launchWorkspaces.length > 0) {
        const rows = launchWorkspaces.map((w) => ({
          launch_id: savedId!,
          workspace_id: w.workspace_id,
          max_subscribers: w.max_subscribers,
          current_count: w.current_count,
        }));
        const { error } = await supabase.from("launch_uchat_workspaces").insert(rows);
        if (error) {
          toast({ title: "Erro ao salvar workspaces", description: error.message, variant: "destructive" });
        }
      }
    }

    toast({ title: isEditing ? "Lançamento atualizado!" : "Lançamento criado!" });
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
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
                Configurações de uso do ActiveCampaign para este lançamento. As credenciais (API URL/Key) ficam no projeto.
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
                  Defina apelidos internos para tags do ActiveCampaign. Permite reusar regras entre lançamentos mudando só as tags.
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

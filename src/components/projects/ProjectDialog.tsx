import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
import { NamedTagsEditor } from "@/components/launches/NamedTagsEditor";
import { UChatWorkspacesEditor } from "@/components/launches/UChatWorkspacesEditor";

interface NamedTag {
  alias: string;
  tag: string;
}

interface UChatWorkspace {
  id?: string;
  workspace_name: string;
  api_token: string;
  max_subscribers: number;
  current_count: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
  onSaved: () => void;
}

export function ProjectDialog({ open, onOpenChange, projectId, onSaved }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugManual, setSlugManual] = useState(false);

  const [acApiUrl, setAcApiUrl] = useState("");
  const [acApiKey, setAcApiKey] = useState("");
  const [acListId, setAcListId] = useState("");
  const [acNamedTags, setAcNamedTags] = useState<NamedTag[]>([]);

  const [uchatWorkspaces, setUchatWorkspaces] = useState<UChatWorkspace[]>([]);

  const isEditing = !!projectId;

  useEffect(() => {
    if (!open) return;
    if (!projectId) {
      resetForm();
      return;
    }
    loadProject(projectId);
  }, [open, projectId]);

  const resetForm = () => {
    setName("");
    setSlug("");
    setSlugManual(false);
    setAcApiUrl("");
    setAcApiKey("");
    setAcListId("");
    setAcNamedTags([]);
    setUchatWorkspaces([]);
  };

  const loadProject = async (id: string) => {
    setLoading(true);
    const { data } = await supabase.from("projects").select("*").eq("id", id).single();
    if (data) {
      setName(data.name);
      setSlug(data.slug || "");
      setSlugManual(true);
      setAcApiUrl(data.ac_api_url || "");
      setAcApiKey(data.ac_api_key || "");
      setAcListId(data.ac_default_list_id || "");
      setAcNamedTags(Array.isArray(data.ac_named_tags) ? (data.ac_named_tags as unknown as NamedTag[]) : []);
    }

    const { data: ws } = await supabase
      .from("uchat_workspaces")
      .select("*")
      .eq("project_id", id)
      .order("created_at");
    if (ws) {
      setUchatWorkspaces(ws.map((w) => ({
        id: w.id,
        workspace_name: w.workspace_name,
        api_token: w.api_token,
        max_subscribers: w.max_subscribers,
        current_count: w.current_count,
      })));
    }
    setLoading(false);
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (!slugManual) setSlug(slugify(val));
  };

  const handleSave = async () => {
    if (!name.trim() || !user) return;
    setSaving(true);

    const projectData = {
      name: name.trim(),
      slug: slug.trim() || slugify(name),
      ac_api_url: acApiUrl || null,
      ac_api_key: acApiKey || null,
      ac_default_list_id: acListId || null,
      ac_named_tags: acNamedTags as unknown as import("@/integrations/supabase/types").Json,
    };

    let savedId = projectId;

    if (isEditing) {
      const { error } = await supabase.from("projects").update(projectData).eq("id", projectId);
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("projects")
        .insert({ ...projectData, created_by: user.id })
        .select("id")
        .single();
      if (error) {
        toast({ title: "Erro ao criar", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
      savedId = data.id;
    }

    // Save uchat workspaces
    if (savedId) {
      await supabase.from("uchat_workspaces").delete().eq("project_id", savedId);
      if (uchatWorkspaces.length > 0) {
        const rows = uchatWorkspaces.map((w) => ({
          project_id: savedId!,
          workspace_name: w.workspace_name,
          api_token: w.api_token,
          max_subscribers: w.max_subscribers,
          current_count: w.current_count,
        }));
        const { error } = await supabase.from("uchat_workspaces").insert(rows);
        if (error) {
          toast({ title: "Erro ao salvar workspaces", description: error.message, variant: "destructive" });
        }
      }
    }

    toast({ title: isEditing ? "Projeto atualizado!" : "Projeto criado!" });
    setSaving(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Editar projeto" : "Novo projeto"}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="general" className="mt-2">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="general">Geral</TabsTrigger>
              <TabsTrigger value="activecampaign">ActiveCampaign</TabsTrigger>
              <TabsTrigger value="uchat">UChat Workspaces</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Nome *</Label>
                <Input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Ex: Curso X" />
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

            <TabsContent value="activecampaign" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>API URL</Label>
                <Input value={acApiUrl} onChange={(e) => setAcApiUrl(e.target.value)} placeholder="https://conta.api-us1.com" />
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input type="password" value={acApiKey} onChange={(e) => setAcApiKey(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="space-y-2">
                <Label>ID da Lista padrão</Label>
                <Input value={acListId} onChange={(e) => setAcListId(e.target.value)} placeholder="Ex: 1" />
              </div>
              <div className="space-y-2">
                <Label>Tags nomeadas</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Defina apelidos internos para tags do ActiveCampaign. Permite reusar regras entre lançamentos.
                </p>
                <NamedTagsEditor tags={acNamedTags} onChange={setAcNamedTags} />
              </div>
            </TabsContent>

            <TabsContent value="uchat" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Cadastre múltiplos workspaces do UChat para distribuir leads e evitar rate limit.
              </p>
              <UChatWorkspacesEditor workspaces={uchatWorkspaces} onChange={setUchatWorkspaces} />
            </TabsContent>
          </Tabs>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEditing ? "Salvar" : "Criar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

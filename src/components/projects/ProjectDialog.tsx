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
import { UChatWorkspacesEditor } from "@/components/launches/UChatWorkspacesEditor";

interface UChatWorkspace {
  id?: string;
  workspace_name: string;
  api_token: string;
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

    try {
      const projectData = {
        name: name.trim(),
        slug: slug.trim() || slugify(name),
        ac_api_url: acApiUrl || null,
        ac_api_key: acApiKey || null,
      };

      let savedId = projectId;

      if (isEditing) {
        const { error } = await supabase.from("projects").update(projectData).eq("id", projectId);
        if (error) {
          toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
          return;
        }
      } else {
        const { data, error } = await supabase
          .from("projects")
          .insert({ ...projectData, created_by: user.id })
          .select("id")
          .maybeSingle();
        if (error) {
          toast({ title: "Erro ao criar", description: error.message, variant: "destructive" });
          return;
        }
        savedId = data?.id ?? null;
      }

      // Save uchat workspaces
      if (savedId) {
        await supabase.from("uchat_workspaces").delete().eq("project_id", savedId);
        if (uchatWorkspaces.length > 0) {
          const rows = uchatWorkspaces.map((w) => ({
            project_id: savedId!,
            workspace_name: w.workspace_name,
            api_token: w.api_token,
          }));
          const { error } = await supabase.from("uchat_workspaces").insert(rows);
          if (error) {
            console.error("Error saving workspaces:", error);
            toast({ title: "Erro ao salvar workspaces", description: error.message, variant: "destructive" });
          }
        }
      }

      toast({ title: isEditing ? "Projeto atualizado!" : "Projeto criado!" });
      onSaved();
    } catch (err) {
      console.error("Error in handleSave:", err);
      toast({ title: "Erro inesperado", description: "Tente novamente.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
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
              <p className="text-sm text-muted-foreground">Credenciais de acesso à conta ActiveCampaign deste projeto.</p>
              <div className="space-y-2">
                <Label>API URL</Label>
                <Input value={acApiUrl} onChange={(e) => setAcApiUrl(e.target.value)} placeholder="https://conta.api-us1.com" />
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input type="password" value={acApiKey} onChange={(e) => setAcApiKey(e.target.value)} placeholder="••••••••" />
              </div>
            </TabsContent>

            <TabsContent value="uchat" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Cadastre os workspaces UChat que este projeto tem acesso. A configuração de uso (limites, distribuição) é feita em cada lançamento.
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

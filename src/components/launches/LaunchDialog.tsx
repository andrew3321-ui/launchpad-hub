import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProject } from "@/contexts/ProjectContext";
import { useToast } from "@/hooks/use-toast";
import { slugify } from "@/lib/slugify";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
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
  };

  const loadLaunch = async (id: string) => {
    setLoading(true);
    const { data } = await supabase.from("launches").select("*").eq("id", id).single();
    if (data) {
      setName(data.name);
      setSlug(data.slug || "");
      setSlugManual(true);
      setCustomStates(Array.isArray(data.custom_states) ? (data.custom_states as string[]) : []);
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
      custom_states: customStates as unknown as import("@/integrations/supabase/types").Json,
      project_id: activeProject.id,
    };

    if (isEditing) {
      const { error } = await supabase.from("launches").update(launchData).eq("id", launchId);
      if (error) {
        toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("launches")
        .insert({ ...launchData, created_by: user.id });
      if (error) {
        toast({ title: "Erro ao criar", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
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
          <div className="space-y-4 mt-4">
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
            <div className="space-y-2">
              <Label>Estados personalizados do lead</Label>
              <CustomStatesEditor states={customStates} onChange={setCustomStates} />
            </div>
          </div>
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

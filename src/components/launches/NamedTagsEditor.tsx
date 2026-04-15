import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";

interface NamedTag {
  alias: string;
  tag: string;
}

interface Props {
  tags: NamedTag[];
  onChange: (tags: NamedTag[]) => void;
}

export function NamedTagsEditor({ tags, onChange }: Props) {
  const addTag = () => {
    onChange([...tags, { alias: "", tag: "" }]);
  };

  const updateTag = (index: number, field: "alias" | "tag", value: string) => {
    const updated = [...tags];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {tags.map((t, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            value={t.alias}
            onChange={(e) => updateTag(i, "alias", e.target.value)}
            placeholder="Apelido interno (ex: entrou_grupo)"
            className="flex-1"
          />
          <span className="text-muted-foreground">→</span>
          <Input
            value={t.tag}
            onChange={(e) => updateTag(i, "tag", e.target.value)}
            placeholder="Tag no AC (ex: entrou-grupo-curso-x)"
            className="flex-1"
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => removeTag(i)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addTag}>
        <Plus className="h-4 w-4 mr-1" /> Adicionar tag
      </Button>
    </div>
  );
}

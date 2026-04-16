import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";

export interface NamedTagDraft {
  alias: string;
  tag: string;
}

interface Props {
  tags: NamedTagDraft[];
  onChange: (tags: NamedTagDraft[]) => void;
}

export function NamedTagsEditor({ tags, onChange }: Props) {
  const addTag = () => {
    onChange([...tags, { alias: "", tag: "" }]);
  };

  const updateTag = (index: number, field: keyof NamedTagDraft, value: string) => {
    const updated = [...tags];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  };

  const removeTag = (index: number) => {
    onChange(tags.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div className="space-y-2">
      {tags.map((tag, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={tag.alias}
            onChange={(event) => updateTag(index, "alias", event.target.value)}
            placeholder="Alias interno (ex: boas_vindas)"
            className="flex-1"
          />
          <span className="text-muted-foreground">-&gt;</span>
          <Input
            value={tag.tag}
            onChange={(event) => updateTag(index, "tag", event.target.value)}
            placeholder="Tag no ActiveCampaign"
            className="flex-1"
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => removeTag(index)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addTag}>
        <Plus className="mr-1 h-4 w-4" /> Adicionar tag
      </Button>
    </div>
  );
}

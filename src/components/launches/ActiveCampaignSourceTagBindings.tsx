import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface ActiveCampaignTagOption {
  id: string;
  name: string;
  description: string | null;
}

interface SourceBinding {
  alias: string;
  label: string;
  helper: string;
  selectedTagIds: string[];
}

interface Props {
  availableTags: ActiveCampaignTagOption[];
  bindings: SourceBinding[];
  disabled?: boolean;
  onToggleTag: (alias: string, tagId: string, checked: boolean) => void;
}

export function ActiveCampaignSourceTagBindings({
  availableTags,
  bindings,
  disabled = false,
  onToggleTag,
}: Props) {
  if (availableTags.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
        Carregue as tags do ActiveCampaign para vincular o roteamento do Typebot e do ManyChat.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {bindings.map((binding) => (
        <div key={binding.alias} className="rounded-xl border border-border/70 bg-background/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium text-foreground">{binding.label}</p>
              <p className="text-sm text-muted-foreground">{binding.helper}</p>
            </div>
            <Badge variant="outline">
              {binding.selectedTagIds.length} tag{binding.selectedTagIds.length === 1 ? "" : "s"}
            </Badge>
          </div>

          <ScrollArea className="mt-4 h-44 rounded-md border border-border/60 px-3 py-2">
            <div className="space-y-3 pr-3">
              {availableTags.map((tag) => {
                const checked = binding.selectedTagIds.includes(tag.id);

                return (
                  <label
                    key={`${binding.alias}-${tag.id}`}
                    className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(nextChecked) =>
                        onToggleTag(binding.alias, tag.id, Boolean(nextChecked))
                      }
                      className="mt-0.5"
                    />
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium leading-none text-foreground">
                          {tag.name}
                        </span>
                        <Badge variant="secondary">#{tag.id}</Badge>
                      </div>
                      {tag.description && (
                        <p className="text-xs text-muted-foreground">{tag.description}</p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      ))}
    </div>
  );
}

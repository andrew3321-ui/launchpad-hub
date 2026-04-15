import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus, GripVertical } from "lucide-react";

interface Props {
  states: string[];
  onChange: (states: string[]) => void;
}

export function CustomStatesEditor({ states, onChange }: Props) {
  const [newState, setNewState] = useState("");

  const addState = () => {
    const val = newState.trim().toLowerCase().replace(/\s+/g, "_");
    if (val && !states.includes(val)) {
      onChange([...states, val]);
      setNewState("");
    }
  };

  const removeState = (index: number) => {
    onChange(states.filter((_, i) => i !== index));
  };

  const moveState = (from: number, to: number) => {
    if (to < 0 || to >= states.length) return;
    const updated = [...states];
    const [item] = updated.splice(from, 1);
    updated.splice(to, 0, item);
    onChange(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {states.map((state, i) => (
          <div key={i} className="flex items-center gap-1">
            <Badge variant="secondary" className="py-1.5 px-3 text-sm flex items-center gap-1.5">
              <button
                type="button"
                className="opacity-50 hover:opacity-100 cursor-grab"
                onClick={() => moveState(i, i - 1)}
                title="Mover para cima"
              >
                <GripVertical className="h-3 w-3" />
              </button>
              <span>{state}</span>
              <button type="button" onClick={() => removeState(i)} className="opacity-50 hover:opacity-100">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={newState}
          onChange={(e) => setNewState(e.target.value)}
          placeholder="Novo estado (ex: inscrito_evento)"
          className="flex-1"
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addState())}
        />
        <Button type="button" variant="outline" size="sm" onClick={addState}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

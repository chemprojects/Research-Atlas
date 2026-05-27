import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import clsx from "clsx";
import {
  RESEARCH_DOMAIN_TREE,
  formatDomainPath,
  type DomainNode,
} from "../data/researchDomains";

interface DomainPickerProps {
  selected: string[];
  onChange: (domains: string[]) => void;
}

function DomainGroup({
  node,
  selected,
  onAdd,
  onRemove,
}: {
  node: DomainNode;
  selected: string[];
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = (node.children?.length ?? 0) > 0;

  if (!hasChildren) {
    const active = selected.includes(node.label);
    return (
      <button
        type="button"
        onClick={() => (active ? onRemove(node.label) : onAdd(node.label))}
        className={clsx(
          "w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors",
          active
            ? "bg-primary-500/20 text-primary-200"
            : "text-gray-300 hover:bg-surface-overlay hover:text-gray-100",
        )}
      >
        {node.label}
      </button>
    );
  }

  return (
    <div className="border-b border-surface-border/50 last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-2 text-sm font-semibold text-gray-200 hover:bg-surface-overlay rounded-md transition-colors"
      >
        {expanded ? (
          <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
        )}
        {node.label}
      </button>
      {expanded && (
        <div className="pl-6 pb-2 space-y-0.5">
          {node.children!.map((child) => {
            const path = formatDomainPath(node.label, child.label);
            const active = selected.includes(path);
            return (
              <button
                key={child.id}
                type="button"
                onClick={() => (active ? onRemove(path) : onAdd(path))}
                className={clsx(
                  "w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-2",
                  active
                    ? "bg-primary-500/15 text-primary-200"
                    : "text-gray-400 hover:bg-surface-overlay hover:text-gray-200",
                )}
              >
                <span className="text-gray-600">—</span>
                <span>{child.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function DomainPicker({ selected, onChange }: DomainPickerProps) {
  const [customInput, setCustomInput] = useState("");

  const add = (path: string) => {
    if (!selected.includes(path)) onChange([...selected, path]);
  };

  const remove = (path: string) => {
    onChange(selected.filter((d) => d !== path));
  };

  const addCustom = () => {
    const t = customInput.trim();
    if (t && !selected.includes(t)) {
      onChange([...selected, t]);
      setCustomInput("");
    }
  };

  return (
    <div className="space-y-3">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((d) => (
            <span
              key={d}
              className="domain-selected-tag tag border text-sm bg-blue-500/20 text-blue-200 border-blue-500/30"
            >
              {d}
              <button
                type="button"
                onClick={() => remove(d)}
                className="ml-1 opacity-80 hover:opacity-100 text-base leading-none"
                aria-label={`Remove ${d}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-surface-border bg-surface-overlay max-h-72 overflow-y-auto divide-y divide-surface-border/50">
        {RESEARCH_DOMAIN_TREE.map((node) => (
          <DomainGroup
            key={node.id}
            node={node}
            selected={selected}
            onAdd={add}
            onRemove={remove}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Add a custom field…"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <button type="button" onClick={addCustom} className="btn-secondary text-sm px-3">
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}

/**
 * INS-CUSTOM-FIELDS — Per-message editors for all defined CFD fields.
 * Renders one row per CustomFieldDef with a type-appropriate input.
 * Mutations: SET_CUSTOM_FIELD_VALUE | CLEAR_CUSTOM_FIELD_VALUE.
 */
import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, X } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { useCustomFieldDefs } from "@/storage/useStore";
import { cn } from "@/lib/utils";
import type { CustomFieldDef, CustomFieldValue } from "@/data/types";

interface CustomFieldStripProps {
  messageId: string;
  customFields: Record<string, CustomFieldValue>;
}

// ─── shared input class ───────────────────────────────────────────────────────

const INPUT_CLS = cn(
  "h-7 w-full rounded-xs border border-border-subtle bg-surface-1 px-2",
  "text-body text-text-primary outline-none placeholder:text-text-muted",
  "focus:border-accent focus:shadow-focus transition-colors",
);

// ─── Type-specific field editors ─────────────────────────────────────────────

interface FieldEditorProps {
  def: CustomFieldDef;
  value: CustomFieldValue;
  onChange: (v: CustomFieldValue) => void;
  onClear: () => void;
}

function TextEditor({ def, value, onChange, onClear }: FieldEditorProps) {
  const strVal = typeof value === "string" ? value : "";
  return (
    <div className="flex items-center gap-1">
      <input
        type={def.type === "url" ? "url" : def.type === "email" ? "email" : "text"}
        value={strVal}
        placeholder={def.description ?? `Enter ${def.name}…`}
        onChange={(e) => onChange(e.target.value || null)}
        className={INPUT_CLS}
      />
      {strVal && (
        <button type="button" onClick={onClear} className="shrink-0 text-text-tertiary hover:text-text-primary">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function LongTextEditor({ def, value, onChange }: FieldEditorProps) {
  const strVal = typeof value === "string" ? value : "";
  return (
    <textarea
      rows={2}
      value={strVal}
      placeholder={def.description ?? `Enter ${def.name}…`}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(INPUT_CLS, "h-auto resize-y py-1")}
    />
  );
}

function NumberEditor({ def, value, onChange, onClear }: FieldEditorProps) {
  const numVal = typeof value === "number" ? value : "";
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={numVal}
        placeholder={def.description ?? "0"}
        onChange={(e) => {
          const v = e.target.valueAsNumber;
          onChange(isNaN(v) ? null : v);
        }}
        className={cn(INPUT_CLS, "font-mono")}
      />
      {numVal !== "" && (
        <button type="button" onClick={onClear} className="shrink-0 text-text-tertiary hover:text-text-primary">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function DateEditor({ def, value, onChange, onClear }: FieldEditorProps) {
  let dateVal = "";
  if (value instanceof Date) {
    dateVal = value.toISOString().slice(0, def.type === "datetime" ? 16 : 10);
  } else if (typeof value === "string") {
    dateVal = value;
  }
  const inputType = def.type === "datetime" ? "datetime-local" : "date";
  return (
    <div className="flex items-center gap-1">
      <input
        type={inputType}
        value={dateVal}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value) : null)}
        className={cn(INPUT_CLS, "font-mono text-mono-sm")}
      />
      {dateVal && (
        <button type="button" onClick={onClear} className="shrink-0 text-text-tertiary hover:text-text-primary">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function BooleanEditor({ value, onChange }: FieldEditorProps) {
  const checked = value === true;
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded-xs accent-accent"
      />
      <span className="text-small text-text-secondary">{checked ? "Yes" : "No"}</span>
    </label>
  );
}

function SelectEditor({ def, value, onChange, onClear }: FieldEditorProps) {
  const options = def.options ?? [];
  const selectedId = typeof value === "string" ? value : null;
  const selected = options.find((o) => o.id === selectedId);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 w-full items-center gap-1.5 rounded-xs border border-border-subtle px-2 text-body",
            "text-text-secondary hover:bg-surface-2 transition-colors",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          {selected ? (
            <span className="flex-1 text-left text-text-primary">{selected.label}</span>
          ) : (
            <span className="flex-1 text-left text-text-muted">Select…</span>
          )}
          <ChevronDown size={11} className="shrink-0 opacity-dim" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            "z-50 min-w-[160px] overflow-hidden rounded-md border border-border-subtle",
            "bg-surface-2 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
          sideOffset={4}
          align="start"
        >
          <div className="p-1">
            {selectedId && (
              <DropdownMenu.Item
                onSelect={onClear}
                className="flex h-7 cursor-pointer items-center rounded-xs px-2 text-body text-text-tertiary outline-none focus:bg-surface-3"
              >
                Clear
              </DropdownMenu.Item>
            )}
            {options.map((opt) => (
              <DropdownMenu.Item
                key={opt.id}
                onSelect={() => onChange(opt.id)}
                className={cn(
                  "flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body outline-none",
                  "text-text-secondary focus:bg-surface-3 focus:text-text-primary",
                  opt.id === selectedId && "text-text-primary",
                )}
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--color-link-${opt.color})` }}
                />
                {opt.label}
                {opt.id === selectedId && (
                  <span className="ml-auto font-mono text-mono-xs text-text-tertiary">✓</span>
                )}
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MultiSelectEditor({ def, value, onChange }: FieldEditorProps) {
  const options = def.options ?? [];
  const selected = Array.isArray(value) ? value : [];

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    onChange(next.length ? next : null);
  }

  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const active = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => toggle(opt.id)}
            className={cn(
              "flex h-6 items-center gap-1 rounded-xs border px-1.5 font-mono text-mono-xs transition-colors",
              active
                ? "border-transparent text-white"
                : "border-border-subtle text-text-tertiary hover:border-border-default hover:text-text-secondary",
            )}
            style={active ? { backgroundColor: `var(--color-link-${opt.color})` } : undefined}
          >
            {opt.label}
          </button>
        );
      })}
      {options.length === 0 && (
        <span className="text-small text-text-muted">No options defined</span>
      )}
    </div>
  );
}

function PersonEditor({ value, onChange, onClear }: FieldEditorProps) {
  const person = typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date) && "type" in (value as object) && (value as { type: string }).type === "person"
    ? (value as { type: "person"; addr: string; name?: string })
    : null;
  const [addr, setAddr] = React.useState(person?.addr ?? "");
  const [name, setName] = React.useState(person?.name ?? "");

  function commit() {
    if (addr.trim()) {
      onChange({ type: "person", addr: addr.trim(), name: name.trim() || undefined });
    } else {
      onClear();
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="email"
        placeholder="Email address"
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
        onBlur={commit}
        className={INPUT_CLS}
      />
      <input
        type="text"
        placeholder="Display name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        className={INPUT_CLS}
      />
    </div>
  );
}

// ─── Single field row ─────────────────────────────────────────────────────────

function FieldRow({ def, value, onChange, onClear }: FieldEditorProps) {
  const props: FieldEditorProps = { def, value, onChange, onClear };
  let editor: React.ReactNode;

  switch (def.type) {
    case "text":
    case "url":
    case "email":
      editor = <TextEditor {...props} />;
      break;
    case "longtext":
      editor = <LongTextEditor {...props} />;
      break;
    case "number":
      editor = <NumberEditor {...props} />;
      break;
    case "date":
    case "datetime":
      editor = <DateEditor {...props} />;
      break;
    case "boolean":
      editor = <BooleanEditor {...props} />;
      break;
    case "select":
      editor = <SelectEditor {...props} />;
      break;
    case "multi-select":
      editor = <MultiSelectEditor {...props} />;
      break;
    case "person":
      editor = <PersonEditor {...props} />;
      break;
    default:
      editor = <TextEditor {...props} />;
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-small text-text-tertiary">{def.name}</span>
      {editor}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export function CustomFieldStrip({ messageId, customFields }: CustomFieldStripProps) {
  const defs = useCustomFieldDefs();
  const setCustomFieldValue = useWorkspace((s) => s.setCustomFieldValue);
  const clearCustomFieldValue = useWorkspace((s) => s.clearCustomFieldValue);

  if (defs.length === 0) {
    return (
      <p className="text-small text-text-muted">
        No custom fields defined. Add fields in Settings → Custom Fields.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {defs.map((def) => (
        <FieldRow
          key={def.id}
          def={def}
          value={customFields[def.id] ?? null}
          onChange={(v) => {
            if (v === null) clearCustomFieldValue(messageId, def.id);
            else setCustomFieldValue(messageId, def.id, v);
          }}
          onClear={() => clearCustomFieldValue(messageId, def.id)}
        />
      ))}
    </div>
  );
}

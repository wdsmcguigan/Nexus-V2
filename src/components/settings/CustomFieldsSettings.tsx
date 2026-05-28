/**
 * SET-CUSTOM-FIELDS — Settings surface for managing CustomFieldDef (CFD) records.
 * Create / rename / delete field definitions. For select/multi-select: add/remove options.
 * Mutations: CREATE_CUSTOM_FIELD | UPDATE_CUSTOM_FIELD | DELETE_CUSTOM_FIELD.
 */
import * as React from "react";
import { Plus, Trash2, GripVertical, ChevronDown, Check } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useWorkspace } from "@/state/workspace";
import { useCustomFieldDefs } from "@/storage/useStore";
import { cn } from "@/lib/utils";
import type { CustomFieldDef, CustomFieldOption, CustomFieldType } from "@/data/types";

// ─── Field type labels ────────────────────────────────────────────────────────

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "longtext", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & time" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "boolean", label: "Boolean (yes/no)" },
  { value: "select", label: "Single select" },
  { value: "multi-select", label: "Multi select" },
  { value: "person", label: "Person" },
];

const OPTION_COLORS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

// ─── Option color picker ─────────────────────────────────────────────────────

function OptionColorDot({ color, selected, onClick }: { color: number; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "size-4 shrink-0 rounded-full border-2 transition-transform hover:scale-110",
        selected ? "border-text-primary" : "border-transparent",
      )}
      style={{ backgroundColor: `var(--color-link-${color})` }}
    />
  );
}

// ─── Select option row ────────────────────────────────────────────────────────

function OptionRow({
  option,
  onUpdate,
  onDelete,
}: {
  option: CustomFieldOption;
  onUpdate: (updates: Partial<CustomFieldOption>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: option.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-xs bg-surface-1 px-2 py-1"
    >
      <button
        type="button"
        aria-label="Drag to reorder option"
        className="shrink-0 cursor-grab text-text-muted hover:text-text-secondary"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={12} />
      </button>
      <div className="flex gap-0.5">
        {OPTION_COLORS.map((c) => (
          <OptionColorDot key={c} color={c} selected={option.color === c} onClick={() => onUpdate({ color: c })} />
        ))}
      </div>
      <input
        type="text"
        value={option.label}
        onChange={(e) => onUpdate({ label: e.target.value })}
        placeholder="Option label…"
        className={cn(
          "flex-1 rounded-xs border-0 bg-transparent text-body text-text-primary outline-none",
          "placeholder:text-text-muted focus:bg-surface-2 focus:px-1",
        )}
      />
      <button type="button" onClick={onDelete} className="shrink-0 text-text-muted hover:text-error">
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ─── Type picker dropdown ─────────────────────────────────────────────────────

function TypePicker({ value, onChange }: { value: CustomFieldType; onChange: (t: CustomFieldType) => void }) {
  const label = FIELD_TYPES.find((t) => t.value === value)?.label ?? value;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-xs border border-border-subtle px-2 text-body",
            "text-text-secondary hover:bg-surface-2 transition-colors",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          <span className="flex-1 text-left">{label}</span>
          <ChevronDown size={11} className="shrink-0 opacity-dim" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            "z-50 min-w-[180px] overflow-hidden rounded-md border border-border-subtle bg-surface-2 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
          sideOffset={4}
        >
          <div className="p-1">
            {FIELD_TYPES.map((t) => (
              <DropdownMenu.Item
                key={t.value}
                onSelect={() => onChange(t.value)}
                className={cn(
                  "flex h-7 cursor-pointer items-center gap-2 rounded-xs px-2 text-body outline-none",
                  "text-text-secondary focus:bg-surface-3 focus:text-text-primary",
                  t.value === value && "text-text-primary",
                )}
              >
                {t.label}
                {t.value === value && <Check size={11} className="ml-auto" />}
              </DropdownMenu.Item>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ─── Expanded field editor ────────────────────────────────────────────────────

function FieldEditor({
  def,
  dragHandleProps,
}: {
  def: CustomFieldDef;
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const updateCustomField = useWorkspace((s) => s.updateCustomField);
  const deleteCustomField = useWorkspace((s) => s.deleteCustomField);
  const reorderOptions = useWorkspace((s) => s.reorderCustomFieldOptions);
  const [expanded, setExpanded] = React.useState(false);
  const [name, setName] = React.useState(def.name);
  const [options, setOptions] = React.useState<CustomFieldOption[]>(def.options ?? []);
  const optionSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleOptionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = options.findIndex((o) => o.id === active.id);
    const newIdx = options.findIndex((o) => o.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = [...options];
    const [moved] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, moved!);
    const renumbered = next.map((o, i) => ({ ...o, position: i }));
    setOptions(renumbered);
    reorderOptions(def.id, renumbered.map((o) => o.id));
  }

  const isSelect = def.type === "select" || def.type === "multi-select";

  function commitName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== def.name) updateCustomField(def.id, { name: trimmed });
    else setName(def.name);
  }

  function changeType(t: CustomFieldType) {
    updateCustomField(def.id, { type: t });
  }

  function addOption() {
    const opt: CustomFieldOption = {
      id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: "",
      color: (options.length % 8) + 1,
      position: options.length,
    };
    const next = [...options, opt];
    setOptions(next);
    updateCustomField(def.id, { options: next });
  }

  function updateOption(id: string, updates: Partial<CustomFieldOption>) {
    const next = options.map((o) => (o.id === id ? { ...o, ...updates } : o));
    setOptions(next);
    updateCustomField(def.id, { options: next });
  }

  function deleteOption(id: string) {
    const next = options.filter((o) => o.id !== id);
    setOptions(next);
    updateCustomField(def.id, { options: next });
  }

  return (
    <div className="rounded-md border border-border-subtle bg-surface-2">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-label="Drag to reorder field"
          className="shrink-0 cursor-grab text-text-muted hover:text-text-secondary"
          {...dragHandleProps}
        >
          <GripVertical size={14} />
        </button>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitName(); } }}
          className={cn(
            "flex-1 rounded-xs border-0 bg-transparent text-body-strong text-text-primary",
            "outline-none focus:bg-surface-1 focus:px-1",
          )}
        />
        <TypePicker value={def.type} onChange={changeType} />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-text-tertiary hover:text-text-primary"
        >
          <ChevronDown
            size={14}
            className={cn("transition-transform", expanded && "rotate-180")}
          />
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm(`Delete field "${def.name}"? All values will be removed.`)) {
              deleteCustomField(def.id);
            }
          }}
          className="shrink-0 text-text-muted hover:text-error"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Expanded: options for select/multi-select */}
      {expanded && isSelect && (
        <div className="border-t border-border-subtle px-3 pb-2 pt-2 space-y-1">
          <div className="text-overline uppercase text-text-tertiary mb-1">Options</div>
          <DndContext
            sensors={optionSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleOptionDragEnd}
          >
            <SortableContext
              items={options.map((o) => o.id)}
              strategy={verticalListSortingStrategy}
            >
              {options.map((opt) => (
                <OptionRow
                  key={opt.id}
                  option={opt}
                  onUpdate={(u) => updateOption(opt.id, u)}
                  onDelete={() => deleteOption(opt.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
          <button
            type="button"
            onClick={addOption}
            className={cn(
              "flex h-7 w-full items-center gap-1.5 rounded-xs px-2 text-body",
              "text-text-tertiary hover:bg-surface-3 hover:text-text-primary transition-colors",
            )}
          >
            <Plus size={12} />
            Add option
          </button>
        </div>
      )}

      {/* Expanded: description for other types */}
      {expanded && !isSelect && (
        <div className="border-t border-border-subtle px-3 pb-2 pt-2">
          <input
            type="text"
            placeholder="Description (optional)…"
            value={def.description ?? ""}
            onChange={(e) => updateCustomField(def.id, { description: e.target.value || undefined })}
            className={cn(
              "h-7 w-full rounded-xs border border-border-subtle bg-surface-1 px-2",
              "text-body text-text-secondary outline-none placeholder:text-text-muted",
              "focus:border-accent focus:shadow-focus",
            )}
          />
        </div>
      )}
    </div>
  );
}

// ─── Create field form ────────────────────────────────────────────────────────

function CreateFieldForm({ onDone }: { onDone: () => void }) {
  const createCustomField = useWorkspace((s) => s.createCustomField);
  const defs = useCustomFieldDefs();
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<CustomFieldType>("text");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { inputRef.current?.focus(); }, []);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    createCustomField({
      id: `cfd-${trimmed.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      vaultId: "local",
      name: trimmed,
      type,
      position: defs.length,
    });
    onDone();
  }

  return (
    <div className="rounded-md border border-accent bg-surface-2 p-3 space-y-2">
      <div className="text-overline uppercase text-text-tertiary">New field</div>
      <input
        ref={inputRef}
        type="text"
        placeholder="Field name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          else if (e.key === "Escape") { e.preventDefault(); onDone(); }
        }}
        className={cn(
          "h-7 w-full rounded-xs border border-border-subtle bg-surface-1 px-2",
          "text-body text-text-primary outline-none placeholder:text-text-muted",
          "focus:border-accent focus:shadow-focus",
        )}
      />
      <TypePicker value={type} onChange={setType} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          className="flex h-7 flex-1 items-center justify-center rounded-xs bg-accent text-body text-text-on-accent hover:opacity-90"
        >
          Create field
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex h-7 items-center justify-center rounded-xs border border-border-subtle px-3 text-body text-text-secondary hover:bg-surface-3"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

function SortableFieldEditor({ def }: { def: CustomFieldDef }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: def.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <FieldEditor def={def} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  );
}

export function CustomFieldsSettings() {
  const defs = useCustomFieldDefs();
  const reorderDefs = useWorkspace((s) => s.reorderCustomFieldDefs);
  const [creating, setCreating] = React.useState(false);
  const defSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDefDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = defs.findIndex((d) => d.id === active.id);
    const newIdx = defs.findIndex((d) => d.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = [...defs];
    const [moved] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, moved!);
    reorderDefs(next.map((d) => d.id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-body-strong text-text-primary">Custom Fields</h2>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-xs border border-border-subtle px-2 text-body",
              "text-text-secondary hover:bg-surface-2 transition-colors",
            )}
          >
            <Plus size={13} />
            Add field
          </button>
        )}
      </div>

      {creating && <CreateFieldForm onDone={() => setCreating(false)} />}

      {defs.length === 0 && !creating ? (
        <p className="text-small text-text-muted">
          No custom fields yet. Custom fields let you annotate emails with typed data (text, dates, numbers, dropdowns, and more).
        </p>
      ) : (
        <DndContext
          sensors={defSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDefDragEnd}
        >
          <SortableContext items={defs.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {defs.map((def) => (
                <SortableFieldEditor key={def.id} def={def} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

import * as React from "react";
import { Plus, Trash2, Pencil, Zap, GripVertical } from "lucide-react";
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
import { Button } from "@/components/ui/Button";
import { RuleEditorDialog } from "@/components/settings/RuleEditorDialog";
import { localStore } from "@/storage/local";
import { isTauri, saveRule, deleteRule } from "@/storage/tauri";
import { saveRuleMutation, deleteRuleMutation, reorderRulesMutation } from "@/state/mutations";
import type { Rule } from "@/data/types";
import { cn } from "@/lib/utils";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1.5 pt-4">
      <span className="text-overline uppercase tracking-wider text-text-tertiary">{children}</span>
    </div>
  );
}

function SortableRuleRow({
  rule,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: Rule;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 px-4 py-3 bg-surface-1">
      <button
        type="button"
        aria-label="Drag to reorder"
        className="shrink-0 cursor-grab text-text-muted hover:text-text-secondary"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <button
        type="button"
        aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
        onClick={onToggle}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent",
          "transition-colors focus:outline-none",
          rule.enabled ? "bg-accent" : "bg-surface-3",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 transform rounded-full bg-white shadow transition-transform",
            rule.enabled ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body text-text-primary">{rule.name}</div>
        <div className="mt-0.5 text-small text-text-tertiary truncate">
          {rule.conditions.length} condition{rule.conditions.length !== 1 ? "s" : ""} ·{" "}
          {rule.actions.length} action{rule.actions.length !== 1 ? "s" : ""}
        </div>
      </div>
      <Button variant="ghost" size="sm" iconOnly aria-label="Edit rule" onClick={onEdit}>
        <Pencil size={13} />
      </Button>
      <Button variant="ghost" size="sm" iconOnly aria-label="Delete rule" onClick={onDelete}>
        <Trash2 size={13} />
      </Button>
    </div>
  );
}

export function RulesSettings() {
  const [rules, setRules] = React.useState<Rule[]>(() =>
    Array.from(localStore.rules?.values() ?? []).sort((a, b) => a.position - b.position)
  );
  const [editing, setEditing] = React.useState<Rule | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const vaultId = localStore.vault?.id ?? "local";

  async function handleSave(rule: Rule) {
    const ruleWithPosition = rules.find((r) => r.id === rule.id)
      ? rule
      : { ...rule, position: rules.length };
    saveRuleMutation(ruleWithPosition);
    setRules((prev) => {
      const exists = prev.find((r) => r.id === ruleWithPosition.id);
      return exists
        ? prev.map((r) => (r.id === ruleWithPosition.id ? ruleWithPosition : r))
        : [...prev, ruleWithPosition];
    });
    if (isTauri()) {
      await saveRule(vaultId, ruleWithPosition);
    }
    setDialogOpen(false);
  }

  async function handleDelete(id: string) {
    deleteRuleMutation(id);
    setRules((prev) => prev.filter((r) => r.id !== id));
    if (isTauri()) {
      await deleteRule(id, vaultId);
    }
  }

  async function handleToggle(rule: Rule) {
    const updated = { ...rule, enabled: !rule.enabled };
    saveRuleMutation(updated);
    setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    if (isTauri()) {
      await saveRule(vaultId, updated);
    }
  }

  function handleNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function handleEdit(rule: Rule) {
    setEditing(rule);
    setDialogOpen(true);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = rules.findIndex((r) => r.id === active.id);
    const newIdx = rules.findIndex((r) => r.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = [...rules];
    const [moved] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, moved!);
    const reordered = next.map((r, i) => ({ ...r, position: i }));
    setRules(reordered);
    reorderRulesMutation(reordered.map((r) => r.id));
    if (isTauri()) {
      for (const r of reordered) await saveRule(vaultId, r);
    }
  }

  return (
    <div>
      <SectionHeader>Automation rules</SectionHeader>

      <div className="px-4 pb-3">
        <p className="text-small text-text-secondary mb-3">
          Rules run automatically on newly received messages. Conditions are evaluated in order; the
          first matching rule applies its actions.
        </p>
        <Button variant="secondary" size="md" onClick={handleNew}>
          <Plus size={14} />
          New rule
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <Zap size={28} className="text-text-muted" />
          <p className="text-body text-text-tertiary">No rules yet.</p>
          <p className="text-small text-text-muted">
            Create a rule to automatically label, archive, or prioritize incoming messages.
          </p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <div className="divide-y divide-border-subtle border-t border-border-subtle">
              {rules.map((rule) => (
                <SortableRuleRow
                  key={rule.id}
                  rule={rule}
                  onToggle={() => handleToggle(rule)}
                  onEdit={() => handleEdit(rule)}
                  onDelete={() => handleDelete(rule.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <RuleEditorDialog
        open={dialogOpen}
        initial={editing}
        vaultId={vaultId}
        onSave={handleSave}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

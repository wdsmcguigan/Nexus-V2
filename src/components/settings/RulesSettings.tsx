import * as React from "react";
import { Plus, Trash2, Pencil, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { RuleEditorDialog } from "@/components/settings/RuleEditorDialog";
import { localStore } from "@/storage/local";
import { isTauri, saveRule, deleteRule } from "@/storage/tauri";
import type { Rule } from "@/data/types";
import { cn } from "@/lib/utils";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1.5 pt-4">
      <span className="text-overline uppercase tracking-wider text-text-tertiary">{children}</span>
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
    const exists = rules.find((r) => r.id === rule.id);
    const updated = exists
      ? rules.map((r) => (r.id === rule.id ? rule : r))
      : [...rules, { ...rule, position: rules.length }];
    setRules(updated);
    if (isTauri()) {
      await saveRule(vaultId, rule);
    }
    setDialogOpen(false);
  }

  async function handleDelete(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
    if (isTauri()) {
      await deleteRule(id, vaultId);
    }
  }

  async function handleToggle(rule: Rule) {
    const updated = { ...rule, enabled: !rule.enabled };
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
        <div className="divide-y divide-border-subtle border-t border-border-subtle">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                aria-label={rule.enabled ? "Disable rule" : "Enable rule"}
                onClick={() => handleToggle(rule)}
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
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label="Edit rule"
                onClick={() => handleEdit(rule)}
              >
                <Pencil size={13} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label="Delete rule"
                onClick={() => handleDelete(rule.id)}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </div>
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

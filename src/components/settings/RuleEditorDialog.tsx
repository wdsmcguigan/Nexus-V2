import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type {
  Rule,
  RuleCondition,
  RuleConditionField,
  RuleConditionOp,
  RuleAction,
  RuleActionKind,
} from "@/data/types";

const CONDITION_FIELDS: { value: RuleConditionField; label: string }[] = [
  { value: "from", label: "From" },
  { value: "to", label: "To" },
  { value: "subject", label: "Subject" },
  { value: "has_attachment", label: "Has attachment" },
  { value: "tag", label: "Tag" },
  { value: "label", label: "Label" },
];

const CONDITION_OPS: { value: RuleConditionOp; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "starts_with", label: "starts with" },
  { value: "not_contains", label: "does not contain" },
];

const ACTION_KINDS: { value: RuleActionKind; label: string; hasValue: boolean }[] = [
  { value: "ADD_LABEL", label: "Add label", hasValue: true },
  { value: "REMOVE_LABEL", label: "Remove label", hasValue: true },
  { value: "SET_STATUS", label: "Set status", hasValue: true },
  { value: "SET_PRIORITY", label: "Set priority (1–4)", hasValue: true },
  { value: "ADD_TAG", label: "Add tag", hasValue: true },
  { value: "STAR", label: "Star", hasValue: false },
  { value: "MARK_READ", label: "Mark as read", hasValue: false },
  { value: "ARCHIVE", label: "Archive", hasValue: false },
  { value: "TRASH", label: "Move to trash", hasValue: false },
];

function newCondition(): RuleCondition {
  return { field: "from", op: "contains", value: "" };
}

function newAction(): RuleAction {
  return { kind: "ADD_LABEL", value: "" };
}

function makeId() {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface Props {
  open: boolean;
  initial: Rule | null;
  vaultId: string;
  onSave: (rule: Rule) => void;
  onClose: () => void;
}

export function RuleEditorDialog({ open, initial, vaultId, onSave, onClose }: Props) {
  const [name, setName] = React.useState("");
  const [logic, setLogic] = React.useState<"AND" | "OR">("AND");
  const [conditions, setConditions] = React.useState<RuleCondition[]>([newCondition()]);
  const [actions, setActions] = React.useState<RuleAction[]>([newAction()]);

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setLogic(initial?.conditionLogic ?? "AND");
      setConditions(initial?.conditions.length ? initial.conditions : [newCondition()]);
      setActions(initial?.actions.length ? initial.actions : [newAction()]);
    }
  }, [open, initial]);

  function handleSave() {
    if (!name.trim()) return;
    const rule: Rule = {
      id: initial?.id ?? makeId(),
      vaultId,
      name: name.trim(),
      conditionLogic: logic,
      conditions,
      actions,
      enabled: initial?.enabled ?? true,
      position: initial?.position ?? 0,
    };
    onSave(rule);
  }

  function updateCondition(i: number, patch: Partial<RuleCondition>) {
    setConditions((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function updateAction(i: number, patch: Partial<RuleAction>) {
    setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  const fieldOpsNeedValue = (field: RuleConditionField) => field !== "has_attachment";

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[520px] max-h-[80vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface-2 shadow-l4 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          <div className="px-5 pb-5 pt-4">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-body-strong text-text-primary">
                {initial ? "Edit rule" : "New rule"}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm" iconOnly aria-label="Close">
                  <X size={14} />
                </Button>
              </Dialog.Close>
            </div>

            {/* Name */}
            <div className="mb-4">
              <label className="mb-1 block text-small text-text-secondary">Rule name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Label newsletters"
                className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
            </div>

            {/* Conditions */}
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-small font-medium text-text-secondary">When</span>
                <div className="flex rounded-sm border border-border-subtle overflow-hidden">
                  {(["AND", "OR"] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLogic(l)}
                      className={cn(
                        "px-2 py-0.5 text-small transition-colors",
                        logic === l
                          ? "bg-accent text-white"
                          : "bg-surface-1 text-text-secondary hover:bg-surface-2",
                      )}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <span className="text-small text-text-tertiary">conditions match:</span>
              </div>

              <div className="space-y-2">
                {conditions.map((cond, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={cond.field}
                      onChange={(e) => updateCondition(i, { field: e.target.value as RuleConditionField, value: "" })}
                      className="rounded-sm border border-border-subtle bg-surface-1 px-2 py-1.5 text-small text-text-primary focus:border-accent focus:outline-none"
                    >
                      {CONDITION_FIELDS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                    {fieldOpsNeedValue(cond.field) && (
                      <select
                        value={cond.op}
                        onChange={(e) => updateCondition(i, { op: e.target.value as RuleConditionOp })}
                        className="rounded-sm border border-border-subtle bg-surface-1 px-2 py-1.5 text-small text-text-primary focus:border-accent focus:outline-none"
                      >
                        {CONDITION_OPS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    )}
                    {fieldOpsNeedValue(cond.field) && (
                      <input
                        value={cond.value}
                        onChange={(e) => updateCondition(i, { value: e.target.value })}
                        placeholder="value"
                        className="min-w-0 flex-1 rounded-sm border border-border-subtle bg-surface-1 px-2 py-1.5 text-small text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                      />
                    )}
                    {cond.field === "has_attachment" && (
                      <span className="text-small text-text-tertiary">is true</span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label="Remove condition"
                      onClick={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
                      disabled={conditions.length === 1}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setConditions((prev) => [...prev, newCondition()])}
                className="mt-2 flex items-center gap-1 text-small text-accent hover:underline"
              >
                <Plus size={12} />
                Add condition
              </button>
            </div>

            {/* Actions */}
            <div className="mb-5">
              <p className="mb-2 text-small font-medium text-text-secondary">Then:</p>
              <div className="space-y-2">
                {actions.map((action, i) => {
                  const def = ACTION_KINDS.find((a) => a.value === action.kind)!;
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <select
                        value={action.kind}
                        onChange={(e) => updateAction(i, { kind: e.target.value as RuleActionKind, value: "" })}
                        className="rounded-sm border border-border-subtle bg-surface-1 px-2 py-1.5 text-small text-text-primary focus:border-accent focus:outline-none"
                      >
                        {ACTION_KINDS.map((a) => (
                          <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                      </select>
                      {def.hasValue && (
                        <input
                          value={action.value ?? ""}
                          onChange={(e) => updateAction(i, { value: e.target.value })}
                          placeholder={action.kind === "SET_PRIORITY" ? "1–4" : "value"}
                          className="min-w-0 flex-1 rounded-sm border border-border-subtle bg-surface-1 px-2 py-1.5 text-small text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                        />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label="Remove action"
                        onClick={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
                        disabled={actions.length === 1}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setActions((prev) => [...prev, newAction()])}
                className="mt-2 flex items-center gap-1 text-small text-accent hover:underline"
              >
                <Plus size={12} />
                Add action
              </button>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button variant="primary" size="sm" onClick={handleSave} disabled={!name.trim()}>
                {initial ? "Save changes" : "Create rule"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

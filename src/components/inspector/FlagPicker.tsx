/**
 * INS-FLAG-PICKER — Full follow-up UI with due date and completion.
 * Replaces the boolean INS-FLAG-TOGGLE from EP-0.
 * Mutations: SET_FLAG | UPDATE_FLAG | COMPLETE_FLAG | CLEAR_FLAG.
 */
import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Flag, FlagOff, Check, X, Calendar, Bell } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { cn, formatAbsoluteTime } from "@/lib/utils";
import type { FlagState } from "@/data/types";

interface FlagPickerProps {
  messageId: string;
  flag: FlagState | null;
}

// ─── Helper: unix-ms → <input type="date"> string (YYYY-MM-DD local) ─────────

function msToDateInput(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateInputToMs(val: string): number {
  return new Date(val).getTime();
}

// ─── Flag status label ────────────────────────────────────────────────────────

function flagStatus(flag: FlagState): { label: string; color: string } {
  if (flag.completedAt != null) {
    return { label: "Completed", color: "var(--color-link-5)" };
  }
  if (flag.dueAt != null) {
    const now = Date.now();
    if (flag.dueAt < now) return { label: "Overdue", color: "var(--color-link-1)" };
    return { label: "Due " + formatAbsoluteTime(new Date(flag.dueAt)), color: "var(--color-link-3)" };
  }
  return { label: "Flagged", color: "var(--color-link-2)" };
}

// ─── Inner popover content ────────────────────────────────────────────────────

function FlagEditor({ messageId, flag, onClose }: { messageId: string; flag: FlagState | null; onClose: () => void }) {
  const setFlag = useWorkspace((s) => s.setFlag);
  const updateFlag = useWorkspace((s) => s.updateFlag);
  const completeFlag = useWorkspace((s) => s.completeFlag);
  const clearFlag = useWorkspace((s) => s.clearFlag);

  const [dueDate, setDueDate] = React.useState<string>(
    flag?.dueAt ? msToDateInput(flag.dueAt) : "",
  );
  const [reminderDate, setReminderDate] = React.useState<string>(
    flag?.reminderAt ? msToDateInput(flag.reminderAt) : "",
  );

  function handleSave() {
    const dueAt = dueDate ? dateInputToMs(dueDate) : undefined;
    const reminderAt = reminderDate ? dateInputToMs(reminderDate) : undefined;
    if (!flag) {
      setFlag(messageId, { setAt: Date.now(), dueAt, reminderAt });
    } else {
      updateFlag(messageId, { dueAt, reminderAt });
    }
    onClose();
  }

  function handleComplete() {
    if (flag) completeFlag(messageId);
    onClose();
  }

  function handleClear() {
    clearFlag(messageId);
    onClose();
  }

  function handleFlagNow() {
    setFlag(messageId, { setAt: Date.now() });
    onClose();
  }

  const isCompleted = flag?.completedAt != null;

  return (
    <div className="w-64 p-3 space-y-3">
      {/* Due date */}
      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-overline uppercase text-text-tertiary">
          <Calendar size={11} />
          Due date
        </label>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className={cn(
            "h-7 w-full rounded-xs border border-border-subtle bg-surface-1 px-2",
            "font-mono text-mono-sm text-text-primary outline-none",
            "focus:border-accent focus:shadow-focus",
          )}
        />
      </div>

      {/* Reminder */}
      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-overline uppercase text-text-tertiary">
          <Bell size={11} />
          Reminder
        </label>
        <input
          type="date"
          value={reminderDate}
          onChange={(e) => setReminderDate(e.target.value)}
          className={cn(
            "h-7 w-full rounded-xs border border-border-subtle bg-surface-1 px-2",
            "font-mono text-mono-sm text-text-primary outline-none",
            "focus:border-accent focus:shadow-focus",
          )}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1 border-t border-border-subtle pt-2">
        {!flag ? (
          <button
            type="button"
            onClick={handleFlagNow}
            className={cn(
              "flex h-7 items-center gap-2 rounded-xs px-2 text-body text-text-secondary",
              "hover:bg-surface-3 hover:text-text-primary",
            )}
          >
            <Flag size={13} />
            Flag without date
          </button>
        ) : null}

        <button
          type="button"
          onClick={handleSave}
          className={cn(
            "flex h-7 items-center gap-2 rounded-xs px-2 text-body",
            "bg-accent text-text-on-accent hover:opacity-90",
          )}
        >
          <Flag size={13} />
          {flag ? "Update flag" : "Set flag with date"}
        </button>

        {flag && !isCompleted && (
          <button
            type="button"
            onClick={handleComplete}
            className={cn(
              "flex h-7 items-center gap-2 rounded-xs px-2 text-body text-text-secondary",
              "hover:bg-surface-3 hover:text-text-primary",
            )}
          >
            <Check size={13} />
            Mark complete
          </button>
        )}

        {flag && (
          <button
            type="button"
            onClick={handleClear}
            className={cn(
              "flex h-7 items-center gap-2 rounded-xs px-2 text-body text-text-tertiary",
              "hover:bg-surface-3 hover:text-text-primary",
            )}
          >
            <X size={13} />
            Remove flag
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export function FlagPicker({ messageId, flag }: FlagPickerProps) {
  const [open, setOpen] = React.useState(false);
  const status = flag ? flagStatus(flag) : null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-xs border px-2 py-1 text-body",
            "transition-colors focus-visible:outline-none focus-visible:shadow-focus",
            flag
              ? "border-transparent bg-surface-3 text-text-primary"
              : "border-border-subtle text-text-tertiary hover:bg-surface-2 hover:text-text-primary",
          )}
        >
          {flag ? (
            <>
              <Flag size={13} style={{ color: status!.color }} />
              <span style={{ color: status!.color }} className="text-small font-medium">
                {status!.label}
              </span>
            </>
          ) : (
            <>
              <FlagOff size={13} />
              <span className="text-small">No flag</span>
            </>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={cn(
            "z-50 overflow-hidden rounded-md border border-border-subtle bg-surface-2 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
          sideOffset={6}
          align="start"
        >
          <FlagEditor messageId={messageId} flag={flag} onClose={() => setOpen(false)} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

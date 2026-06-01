import * as React from "react";
import { Plus, Trash2, Pencil, Check, X, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { cn } from "@/lib/utils";
import { localStore } from "@/storage/local";
import { useCalendars, useAccounts } from "@/storage/useStore";
import { isTauri, syncGoogleCalendar } from "@/storage/tauri";
import {
  upsertCalendarMutation,
  updateCalendarMutation,
  deleteCalendarMutation,
} from "@/state/mutations";
import type { Calendar } from "@/data/types";
import { toast } from "sonner";

function SectionHeader({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pb-1.5 pt-4">
      <span className="text-overline uppercase tracking-wider text-text-tertiary">{children}</span>
      {action}
    </div>
  );
}

/**
 * Calendar.color is a free-form TEXT in the DB. Google sync writes hex (#4285f4);
 * local calendars created here store the 1–21 index from ColorPicker as a string
 * so the swatch tracks the user's theme via the existing --color-link-N CSS vars.
 */
function swatchStyle(color: string | undefined): React.CSSProperties {
  if (!color) return { backgroundColor: "var(--color-link-7)" };
  if (/^\d+$/.test(color)) return { backgroundColor: `var(--color-link-${color})` };
  return { backgroundColor: color };
}

function parseLocalColor(color: string | undefined): number {
  if (color && /^\d+$/.test(color)) {
    const n = parseInt(color, 10);
    if (n >= 1 && n <= 21) return n;
  }
  return 7;
}

function makeLocalId(): string {
  return `cal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface LocalRowProps {
  cal: Calendar;
  onUpdate: (patch: Partial<Calendar>) => void;
  onDelete: () => void;
}

function LocalCalendarRow({ cal, onUpdate, onDelete }: LocalRowProps) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(cal.name);
  const [colorIndex, setColorIndex] = React.useState(parseLocalColor(cal.color));

  React.useEffect(() => {
    if (!editing) {
      setName(cal.name);
      setColorIndex(parseLocalColor(cal.color));
    }
  }, [cal.id, cal.name, cal.color, editing]);

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Calendar name is required");
      return;
    }
    onUpdate({
      name: trimmed,
      color: String(colorIndex),
      updatedAt: Date.now(),
    });
    setEditing(false);
  }

  function cancel() {
    setName(cal.name);
    setColorIndex(parseLocalColor(cal.color));
    setEditing(false);
  }

  return (
    <div className="flex items-start gap-3 px-4 py-2 hover:bg-surface-2 transition-colors">
      <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={swatchStyle(cal.color)} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") cancel();
              }}
              className="w-full rounded-sm border border-border-default bg-surface-1 px-2 py-1 text-body text-text-primary focus:border-accent focus:outline-none"
            />
            <ColorPicker value={colorIndex} onChange={setColorIndex} />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="truncate text-body text-text-primary">{cal.name}</span>
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-caption text-text-tertiary">
              <input
                type="checkbox"
                checked={cal.enabled}
                onChange={() => onUpdate({ enabled: !cal.enabled, updatedAt: Date.now() })}
                className="accent-accent"
              />
              Visible
            </label>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <>
            <button
              type="button"
              onClick={commit}
              className="rounded-xs p-1 text-success hover:bg-surface-3 transition-colors"
              title="Save"
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              onClick={cancel}
              className="rounded-xs p-1 text-text-muted hover:bg-surface-3 transition-colors"
              title="Cancel"
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-xs p-1 text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors"
              title="Edit"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-xs p-1 text-text-muted hover:text-danger hover:bg-surface-3 transition-colors"
              title="Delete"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function GoogleCalendarRow({ cal, onToggle }: { cal: Calendar; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-surface-2 transition-colors">
      <span className="h-3 w-3 shrink-0 rounded-full" style={swatchStyle(cal.color)} />
      <div className="min-w-0 flex-1">
        <span className="truncate text-body text-text-primary">{cal.name}</span>
        {cal.readOnly && (
          <span className="ml-2 text-caption text-text-tertiary">(read-only)</span>
        )}
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 text-caption text-text-tertiary">
        <input
          type="checkbox"
          checked={cal.enabled}
          onChange={onToggle}
          className="accent-accent"
        />
        Sync &amp; show
      </label>
    </div>
  );
}

export function CalendarsList() {
  const calendars = useCalendars();
  const accounts = useAccounts();
  const vaultId = localStore.vault?.id ?? "local";
  const [syncingAccount, setSyncingAccount] = React.useState<string | null>(null);

  const local = calendars.filter((c) => c.provider === "local");
  const byAccount = new Map<string, Calendar[]>();
  for (const cal of calendars) {
    if (cal.provider === "google" && cal.accountId) {
      const list = byAccount.get(cal.accountId) ?? [];
      list.push(cal);
      byAccount.set(cal.accountId, list);
    }
  }

  function handleCreateLocal() {
    const id = makeLocalId();
    const now = Date.now();
    upsertCalendarMutation({
      id,
      vaultId,
      name: "New calendar",
      color: "7",
      enabled: true,
      readOnly: false,
      provider: "local",
      createdAt: now,
      updatedAt: now,
    });
  }

  function handleUpdateLocal(cal: Calendar, patch: Partial<Calendar>) {
    updateCalendarMutation({ ...cal, ...patch });
  }

  function handleDeleteLocal(cal: Calendar) {
    if (cal.id === "local-default") {
      toast.error("Can't delete the default calendar");
      return;
    }
    // Refuse if events are bound to it — keeps the action reversible.
    let count = 0;
    for (const evt of localStore.calendarEvents.values()) {
      if (evt.calendarLocalId === cal.id) {
        count += 1;
        if (count > 0) break;
      }
    }
    if (count > 0) {
      toast.error(`Move or delete this calendar's events first`);
      return;
    }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${cal.name}"?`)) return;
    deleteCalendarMutation(cal.id);
  }

  function handleToggleGoogle(cal: Calendar) {
    updateCalendarMutation({ ...cal, enabled: !cal.enabled, updatedAt: Date.now() });
  }

  async function handleSyncAccount(accountId: string) {
    if (!isTauri()) return;
    setSyncingAccount(accountId);
    try {
      const n = await syncGoogleCalendar(accountId);
      toast.success(`Synced ${n} event${n === 1 ? "" : "s"}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Sync failed: ${msg}`);
    } finally {
      setSyncingAccount(null);
    }
  }

  return (
    <div className="pb-6">
      <SectionHeader
        action={
          <Button variant="ghost" size="xs" onClick={handleCreateLocal}>
            <Plus size={11} />
            New calendar
          </Button>
        }
      >
        Local calendars
      </SectionHeader>
      {local.length === 0 ? (
        <p className="px-4 py-2 text-small text-text-muted">No local calendars yet.</p>
      ) : (
        <div>
          {local.map((cal) => (
            <LocalCalendarRow
              key={cal.id}
              cal={cal}
              onUpdate={(patch) => handleUpdateLocal(cal, patch)}
              onDelete={() => handleDeleteLocal(cal)}
            />
          ))}
        </div>
      )}

      {Array.from(byAccount.entries()).map(([accountId, cals]) => {
        const account = accounts.find((a) => a.id === accountId);
        const label = account?.email ?? accountId;
        const syncing = syncingAccount === accountId;
        return (
          <div key={accountId}>
            <SectionHeader
              action={
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => handleSyncAccount(accountId)}
                  disabled={syncing}
                >
                  {syncing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                  {syncing ? "Syncing…" : "Sync now"}
                </Button>
              }
            >
              Google — {label}
            </SectionHeader>
            {cals.length === 0 ? (
              <p className="px-4 py-2 text-small text-text-muted">
                No calendars yet. Click <em>Sync now</em> to discover them.
              </p>
            ) : (
              <div>
                {cals
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((cal) => (
                    <GoogleCalendarRow key={cal.id} cal={cal} onToggle={() => handleToggleGoogle(cal)} />
                  ))}
              </div>
            )}
          </div>
        );
      })}

      {accounts.length === 0 && byAccount.size === 0 && (
        <p className={cn("px-4 py-4 text-small text-text-muted")}>
          Connect a Gmail account in <strong>Settings → Accounts</strong> to discover Google calendars.
        </p>
      )}
    </div>
  );
}

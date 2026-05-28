import * as React from "react";
import { Plus, Trash2, Pencil, CalendarDays, X, Check } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/Button";
import { localStore } from "@/storage/local";
import { isTauri, saveEventTemplate, deleteEventTemplate } from "@/storage/tauri";
import { saveEventTemplateMutation, deleteEventTemplateMutation } from "@/state/mutations";
import type { EventTemplate } from "@/data/types";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1.5 pt-4">
      <span className="text-overline uppercase tracking-wider text-text-tertiary">{children}</span>
    </div>
  );
}

function makeId() {
  return `evtmpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface EditorDialogProps {
  open: boolean;
  initial: EventTemplate | null;
  vaultId: string;
  onSave: (tmpl: EventTemplate) => void;
  onClose: () => void;
}

function EventTemplateEditorDialog({ open, initial, vaultId, onSave, onClose }: EditorDialogProps) {
  const [name, setName] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [durationMinutes, setDurationMinutes] = React.useState(60);
  const [attendeesText, setAttendeesText] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setTitle(initial?.title ?? "");
      setDescription(initial?.description ?? "");
      setLocation(initial?.location ?? "");
      setDurationMinutes(initial?.durationMinutes ?? 60);
      setAttendeesText((initial?.defaultAttendees ?? []).join("\n"));
    }
  }, [open, initial]);

  function handleSave() {
    if (!name.trim()) return;
    const defaultAttendees = attendeesText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    onSave({
      id: initial?.id ?? makeId(),
      vaultId,
      name: name.trim(),
      title: title.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      durationMinutes,
      defaultAttendees,
      createdAt: initial?.createdAt ?? Date.now(),
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[520px] max-h-[80vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface-2 shadow-l4 focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <div className="px-5 pb-5 pt-4">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-body-strong text-text-primary">
                {initial ? "Edit event template" : "New event template"}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm" iconOnly aria-label="Close">
                  <X size={14} />
                </Button>
              </Dialog.Close>
            </div>

            <div className="space-y-3 mb-5">
              <div>
                <label className="mb-1 block text-small text-text-secondary">Template name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. 1:1 meeting"
                  className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-small text-text-secondary">Event title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Pre-filled event title"
                  className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-small text-text-secondary">Location</label>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  />
                </div>
                <div className="w-32">
                  <label className="mb-1 block text-small text-text-secondary">Duration (min)</label>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Math.max(5, parseInt(e.target.value, 10) || 60))}
                    className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-small text-text-secondary">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Optional event description"
                  className="w-full resize-y rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-small text-text-secondary">Default attendees</label>
                <textarea
                  value={attendeesText}
                  onChange={(e) => setAttendeesText(e.target.value)}
                  rows={3}
                  placeholder="One email per line"
                  className="w-full resize-y rounded-sm border border-border-default bg-surface-1 px-3 py-2 font-mono text-mono-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
                <p className="mt-1 text-caption text-text-muted">
                  One email address per line, or comma-separated.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button variant="primary" size="sm" onClick={handleSave} disabled={!name.trim()}>
                <Check size={13} />
                {initial ? "Save changes" : "Create template"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function EventTemplatesSettings() {
  const [templates, setTemplates] = React.useState<EventTemplate[]>(() =>
    Array.from(localStore.eventTemplates?.values() ?? []).sort((a, b) => a.createdAt - b.createdAt)
  );
  const [editing, setEditing] = React.useState<EventTemplate | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const vaultId = localStore.vault?.id ?? "local";

  async function handleSave(tmpl: EventTemplate) {
    saveEventTemplateMutation(tmpl);
    setTemplates((prev) => {
      const exists = prev.find((t) => t.id === tmpl.id);
      return exists ? prev.map((t) => (t.id === tmpl.id ? tmpl : t)) : [...prev, tmpl];
    });
    if (isTauri()) await saveEventTemplate(vaultId, tmpl);
    setDialogOpen(false);
  }

  async function handleDelete(id: string) {
    deleteEventTemplateMutation(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    if (isTauri()) await deleteEventTemplate(id, vaultId);
  }

  return (
    <div>
      <SectionHeader>Calendar event templates</SectionHeader>

      <div className="px-4 pb-3">
        <p className="text-small text-text-secondary mb-3">
          Templates pre-fill the event title, location, duration, and attendees when creating a new calendar event.
        </p>
        <Button variant="secondary" size="md" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus size={14} />
          New template
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <CalendarDays size={28} className="text-text-muted" />
          <p className="text-body text-text-tertiary">No event templates yet.</p>
          <p className="text-small text-text-muted">
            Create a template to quickly pre-fill fields when scheduling recurring meetings.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border-subtle border-t border-border-subtle">
          {templates.map((tmpl) => (
            <div key={tmpl.id} className="flex items-center gap-3 px-4 py-3">
              <CalendarDays size={14} className="shrink-0 text-text-tertiary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body text-text-primary">{tmpl.name}</div>
                <div className="mt-0.5 truncate text-small text-text-tertiary">
                  {tmpl.title || "(no title)"} · {tmpl.durationMinutes} min
                  {tmpl.defaultAttendees.length > 0 && ` · ${tmpl.defaultAttendees.length} attendee${tmpl.defaultAttendees.length !== 1 ? "s" : ""}`}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label="Edit template"
                onClick={() => { setEditing(tmpl); setDialogOpen(true); }}
              >
                <Pencil size={13} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label="Delete template"
                onClick={() => handleDelete(tmpl.id)}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
        </div>
      )}

      <EventTemplateEditorDialog
        open={dialogOpen}
        initial={editing}
        vaultId={vaultId}
        onSave={handleSave}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

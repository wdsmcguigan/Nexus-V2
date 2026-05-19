import * as React from "react";
import { Plus, Trash2, Pencil, FileText, X, Check } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/Button";
import { localStore } from "@/storage/local";
import { isTauri, saveTemplate, deleteTemplate } from "@/storage/tauri";
import { saveTemplateMutation, deleteTemplateMutation } from "@/state/mutations";
import type { Template } from "@/data/types";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1.5 pt-4">
      <span className="text-overline uppercase tracking-wider text-text-tertiary">{children}</span>
    </div>
  );
}

function makeId() {
  return `tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface EditorDialogProps {
  open: boolean;
  initial: Template | null;
  vaultId: string;
  onSave: (tmpl: Template) => void;
  onClose: () => void;
}

function TemplateEditorDialog({ open, initial, vaultId, onSave, onClose }: EditorDialogProps) {
  const [name, setName] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setSubject(initial?.subject ?? "");
      setBody(initial?.bodyHtml ?? "");
    }
  }, [open, initial]);

  function handleSave() {
    if (!name.trim()) return;
    onSave({
      id: initial?.id ?? makeId(),
      vaultId,
      name: name.trim(),
      subject: subject.trim(),
      bodyHtml: body,
      createdAt: initial?.createdAt ?? Date.now(),
    });
  }

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
                {initial ? "Edit template" : "New template"}
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
                  placeholder="e.g. Introduction email"
                  className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-small text-text-secondary">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject"
                  className="w-full rounded-sm border border-border-default bg-surface-1 px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-small text-text-secondary">Body</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  placeholder="Email body (HTML supported)"
                  className="w-full resize-y rounded-sm border border-border-default bg-surface-1 px-3 py-2 font-mono text-mono-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
                <p className="mt-1 text-caption text-text-muted">
                  HTML is supported. When applied in the composer, the editor will show the rendered content.
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

export function TemplatesSettings() {
  const [templates, setTemplates] = React.useState<Template[]>(() =>
    Array.from(localStore.templates?.values() ?? []).sort((a, b) => a.createdAt - b.createdAt)
  );
  const [editing, setEditing] = React.useState<Template | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const vaultId = localStore.vault?.id ?? "local";

  async function handleSave(tmpl: Template) {
    saveTemplateMutation(tmpl);
    setTemplates((prev) => {
      const exists = prev.find((t) => t.id === tmpl.id);
      return exists ? prev.map((t) => (t.id === tmpl.id ? tmpl : t)) : [...prev, tmpl];
    });
    if (isTauri()) {
      await saveTemplate(vaultId, tmpl);
    }
    setDialogOpen(false);
  }

  async function handleDelete(id: string) {
    deleteTemplateMutation(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    if (isTauri()) {
      await deleteTemplate(id, vaultId);
    }
  }

  return (
    <div>
      <SectionHeader>Email templates</SectionHeader>

      <div className="px-4 pb-3">
        <p className="text-small text-text-secondary mb-3">
          Templates let you quickly apply a pre-written subject and body when composing a new message.
        </p>
        <Button variant="secondary" size="md" onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus size={14} />
          New template
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
          <FileText size={28} className="text-text-muted" />
          <p className="text-body text-text-tertiary">No templates yet.</p>
          <p className="text-small text-text-muted">
            Create a template to save time on frequently-sent emails.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border-subtle border-t border-border-subtle">
          {templates.map((tmpl) => (
            <div key={tmpl.id} className="flex items-center gap-3 px-4 py-3">
              <FileText size={14} className="shrink-0 text-text-tertiary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-body text-text-primary">{tmpl.name}</div>
                {tmpl.subject && (
                  <div className="mt-0.5 truncate text-small text-text-tertiary">{tmpl.subject}</div>
                )}
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

      <TemplateEditorDialog
        open={dialogOpen}
        initial={editing}
        vaultId={vaultId}
        onSave={handleSave}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

import * as React from "react";
import {
  Mail,
  Phone,
  Building2,
  MapPin,
  Globe,
  Tag,
  MessageSquare,
  Pencil,
  Check,
  X,
  Plus,
  ExternalLink,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useContactByEmail, useContactMessageCount } from "@/storage/useStore";
import { useWorkspace } from "@/state/workspace";
import { updateContact, upsertContact } from "@/state/mutations";
import { localStore } from "@/storage/local";
import { pickPanelLink } from "@/design-system/tokens";
import { cn } from "@/lib/utils";
import type { Contact } from "@/data/types";

// ─── Inline editable field ────────────────────────────────────────────────────

interface EditableFieldProps {
  value: string;
  placeholder?: string;
  onSave: (value: string) => void;
  className?: string;
  monospace?: boolean;
}

function EditableField({
  value,
  placeholder,
  onSave,
  className,
  monospace,
}: EditableFieldProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value) onSave(draft.trim());
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          onBlur={commit}
          placeholder={placeholder}
          className={cn(
            "min-w-0 flex-1 rounded-xs bg-surface-2 px-1.5 py-0.5 text-small text-text-primary",
            "border border-border-default focus:border-accent focus:outline-none",
            monospace && "font-mono text-mono-sm",
            className,
          )}
        />
        <button
          aria-label="Save"
          onMouseDown={(e) => { e.preventDefault(); commit(); }}
          className="text-success hover:opacity-75"
        >
          <Check size={12} />
        </button>
        <button
          aria-label="Cancel"
          onMouseDown={(e) => { e.preventDefault(); cancel(); }}
          className="text-text-tertiary hover:opacity-75"
        >
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <span className={cn("group/ef inline-flex items-center gap-1", className)}>
      <span className={cn(monospace && "font-mono text-mono-sm")}>
        {value || <span className="italic text-text-muted">{placeholder}</span>}
      </span>
      <button
        aria-label="Edit"
        onClick={() => { setDraft(value); setEditing(true); }}
        className="opacity-0 group-hover/ef:opacity-100 text-text-tertiary hover:text-text-primary transition-opacity"
      >
        <Pencil size={10} />
      </button>
    </span>
  );
}

// ─── ContactCard ──────────────────────────────────────────────────────────────

interface ContactCardProps {
  email: string;
  name?: string;
  compact?: boolean;
}

export function ContactCard({ email, name, compact = false }: ContactCardProps) {
  const contact = useContactByEmail(email);
  const openContactsPanel = useWorkspace((s) => s.openContactsPanel);

  if (!contact) {
    return (
      <NoContactCard email={email} name={name ?? email} compact={compact} />
    );
  }

  return (
    <FoundContactCard
      contact={contact}
      compact={compact}
      onOpenPanel={() => openContactsPanel(contact.id)}
    />
  );
}

// ─── No-contact fallback ──────────────────────────────────────────────────────

function NoContactCard({
  email,
  name,
  compact,
}: {
  email: string;
  name: string;
  compact: boolean;
}) {
  const colorSeed = pickPanelLink(email);

  const handleSave = () => {
    const contactId = `contact-${email.replace(/[^a-z0-9]/gi, "-")}`;
    const existing = localStore.contacts.get(contactId);
    if (existing) return;
    const contact: Contact = {
      id: contactId,
      vaultId: localStore.vault?.id ?? "local",
      name,
      emails: [email],
      phones: [],
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertContact(contact);
  };

  if (compact) {
    return (
      <div className="flex items-start gap-3">
        <Avatar name={name} size={36} colorSeed={colorSeed} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-strong text-text-primary">{name}</div>
          <div className="font-mono text-mono-xs text-text-tertiary truncate">{email}</div>
          <div className="mt-2">
            <Button variant="ghost" size="xs" onClick={handleSave}>
              <Plus />
              Save contact
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar name={name} size={48} colorSeed={colorSeed} />
        <div className="min-w-0 flex-1">
          <div className="text-h3 font-semibold text-text-primary">{name}</div>
          <div className="font-mono text-mono-sm text-text-tertiary">{email}</div>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={handleSave}>
        <Plus />
        Save contact
      </Button>
    </div>
  );
}

// ─── Found contact card ───────────────────────────────────────────────────────

function FoundContactCard({
  contact,
  compact,
  onOpenPanel,
}: {
  contact: Contact;
  compact: boolean;
  onOpenPanel: () => void;
}) {
  const msgCount = useContactMessageCount(contact.id);
  const colorSeed = pickPanelLink(contact.emails[0] ?? contact.id);
  const openContactMessages = useWorkspace((s) => s.openContactMessages);

  const save = (patch: Parameters<typeof updateContact>[1]) => {
    updateContact(contact.id, patch);
  };

  if (compact) {
    return (
      <div className="flex items-start gap-3">
        <Avatar name={contact.name} size={36} colorSeed={colorSeed} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-strong text-text-primary">
            <EditableField
              value={contact.name}
              placeholder="Name"
              onSave={(v) => save({ name: v })}
            />
          </div>

          {/* Primary email */}
          <div className="font-mono text-mono-xs text-text-tertiary truncate">
            {contact.emails[0] ?? ""}
          </div>

          {/* Company + title */}
          {(contact.company || contact.title) && (
            <div className="mt-0.5 flex items-center gap-1 text-small text-text-secondary">
              <Building2 size={11} className="shrink-0 text-text-tertiary" />
              <span className="truncate">
                {[contact.title, contact.company].filter(Boolean).join(" · ")}
              </span>
            </div>
          )}

          {/* Message count */}
          {msgCount > 0 && (
            <div className="mt-1 flex items-center gap-1 text-caption text-text-tertiary">
              <MessageSquare size={10} />
              <span>{msgCount} message{msgCount !== 1 ? "s" : ""}</span>
            </div>
          )}

          {/* Tags */}
          {contact.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {contact.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-0.5 rounded-xs bg-surface-3 px-1 py-0.5 font-mono text-mono-xs text-text-secondary"
                >
                  <Tag size={9} />
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Notes (editable) */}
          <div className="mt-1.5 text-small text-text-secondary">
            <EditableField
              value={contact.notes ?? ""}
              placeholder="Add a note…"
              onSave={(v) => save({ notes: v || undefined })}
            />
          </div>

          {/* Open in contacts panel */}
          <div className="mt-2">
            <Button variant="ghost" size="xs" onClick={onOpenPanel}>
              <ExternalLink />
              Open contact
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Full mode (ContactsPanel right column)
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Avatar name={contact.name} size={56} colorSeed={colorSeed} />
        <div className="min-w-0 flex-1">
          <div className="text-h2 font-bold text-text-primary">
            <EditableField
              value={contact.name}
              placeholder="Name"
              onSave={(v) => save({ name: v })}
            />
          </div>
          {(contact.company || contact.title) && (
            <div className="mt-0.5 text-body text-text-secondary">
              <EditableField
                value={[contact.title, contact.company].filter(Boolean).join(", ")}
                placeholder="Title, Company"
                onSave={(raw) => {
                  const parts = raw.split(",").map((s) => s.trim());
                  save({ title: parts[0] || undefined, company: parts[1] || undefined });
                }}
              />
            </div>
          )}
          {!contact.company && !contact.title && (
            <div className="mt-0.5 text-body text-text-secondary">
              <EditableField
                value=""
                placeholder="Title, Company"
                onSave={(raw) => {
                  const parts = raw.split(",").map((s) => s.trim());
                  save({ title: parts[0] || undefined, company: parts[1] || undefined });
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Message count badge */}
      {msgCount > 0 && (
        <button
          type="button"
          onClick={() => openContactMessages(contact.id)}
          className="flex items-center gap-1.5 text-small text-text-secondary hover:text-accent hover:underline"
        >
          <MessageSquare size={13} className="text-text-tertiary" />
          {msgCount} message{msgCount !== 1 ? "s" : ""}
        </button>
      )}

      {/* Emails */}
      <FieldSection icon={<Mail size={14} />} label="Email">
        <div className="flex flex-col gap-1">
          {contact.emails.map((e, i) => (
            <div key={e} className="font-mono text-mono-sm text-text-primary">
              {i === 0 ? (
                <EditableField
                  value={e}
                  monospace
                  placeholder="email@example.com"
                  onSave={(v) => {
                    const next = [...contact.emails];
                    next[0] = v;
                    save({ emails: next });
                  }}
                />
              ) : (
                <span>{e}</span>
              )}
              {i === 0 && contact.emails.length > 1 && (
                <span className="ml-1 text-caption text-text-tertiary">(primary)</span>
              )}
            </div>
          ))}
          <AddItemButton
            label="Add email"
            onAdd={(v) => save({ emails: [...contact.emails, v] })}
          />
        </div>
      </FieldSection>

      {/* Phones */}
      <FieldSection icon={<Phone size={14} />} label="Phone">
        <div className="flex flex-col gap-1">
          {contact.phones.map((p, i) => (
            <div key={p} className="font-mono text-mono-sm text-text-primary">
              <EditableField
                value={p}
                monospace
                placeholder="+1 555 000 0000"
                onSave={(v) => {
                  const next = [...contact.phones];
                  next[i] = v;
                  save({ phones: next.filter(Boolean) });
                }}
              />
            </div>
          ))}
          <AddItemButton
            label="Add phone"
            onAdd={(v) => save({ phones: [...contact.phones, v] })}
          />
        </div>
      </FieldSection>

      {/* Website */}
      <FieldSection icon={<Globe size={14} />} label="Website">
        <EditableField
          value={contact.website ?? ""}
          placeholder="https://…"
          onSave={(v) => save({ website: v || undefined })}
        />
      </FieldSection>

      {/* Location */}
      <FieldSection icon={<MapPin size={14} />} label="Location">
        <EditableField
          value={contact.location ?? ""}
          placeholder="City, Country"
          onSave={(v) => save({ location: v || undefined })}
        />
      </FieldSection>

      {/* Tags */}
      <FieldSection icon={<Tag size={14} />} label="Tags">
        <div className="flex flex-wrap gap-1">
          {contact.tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-0.5 rounded-xs bg-surface-3 px-1.5 py-0.5 font-mono text-mono-xs text-text-secondary"
            >
              {t}
              <button
                aria-label={`Remove tag ${t}`}
                onClick={() => save({ tags: contact.tags.filter((x) => x !== t) })}
                className="ml-0.5 text-text-muted hover:text-danger"
              >
                <X size={9} />
              </button>
            </span>
          ))}
          <AddItemButton
            label="Add tag"
            onAdd={(v) => {
              if (!contact.tags.includes(v)) save({ tags: [...contact.tags, v] });
            }}
          />
        </div>
      </FieldSection>

      {/* Notes */}
      <div className="flex flex-col gap-1">
        <div className="text-overline uppercase text-text-tertiary">Notes</div>
        <EditableField
          value={contact.notes ?? ""}
          placeholder="Add notes…"
          onSave={(v) => save({ notes: v || undefined })}
        />
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function FieldSection({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex w-5 shrink-0 items-start justify-center text-text-tertiary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-caption text-text-tertiary">{label}</div>
        {children}
      </div>
    </div>
  );
}

function AddItemButton({
  label,
  onAdd,
}: {
  label: string;
  onAdd: (value: string) => void;
}) {
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const commit = () => {
    if (draft.trim()) onAdd(draft.trim());
    setAdding(false);
    setDraft("");
  };

  const cancel = () => {
    setAdding(false);
    setDraft("");
  };

  if (adding) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          onBlur={commit}
          className="min-w-0 flex-1 rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-mono-sm text-text-primary border border-border-default focus:border-accent focus:outline-none"
        />
        <button onMouseDown={(e) => { e.preventDefault(); commit(); }} className="text-success">
          <Check size={12} />
        </button>
        <button onMouseDown={(e) => { e.preventDefault(); cancel(); }} className="text-text-tertiary">
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setAdding(true)}
      className="inline-flex items-center gap-0.5 text-caption text-text-tertiary hover:text-text-primary transition-colors"
    >
      <Plus size={11} />
      {label}
    </button>
  );
}

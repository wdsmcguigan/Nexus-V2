import * as React from "react";
import { Search, UserPlus, Users } from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ContactCard } from "@/components/contacts/ContactCard";
import { useContacts, useContactMessageCount } from "@/storage/useStore";
import { useWorkspace } from "@/state/workspace";
import { upsertContact } from "@/state/mutations";
import { localStore } from "@/storage/local";
import { pickPanelLink } from "@/design-system/tokens";
import { cn } from "@/lib/utils";

// ─── Row component ────────────────────────────────────────────────────────────

function ContactRow({
  contactId,
  name,
  primaryEmail,
  isSelected,
  onSelect,
}: {
  contactId: string;
  name: string;
  primaryEmail: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const msgCount = useContactMessageCount(contactId);
  const colorSeed = pickPanelLink(primaryEmail || contactId);

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-xs px-3 py-2 text-left transition-colors",
        isSelected
          ? "bg-accent/10 text-text-primary"
          : "hover:bg-surface-2 text-text-primary",
      )}
    >
      <Avatar name={name} size={32} colorSeed={colorSeed} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-strong">{name}</div>
        <div className="truncate font-mono text-mono-xs text-text-tertiary">
          {primaryEmail}
        </div>
      </div>
      {msgCount > 0 && (
        <span className="shrink-0 rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-mono-xs text-text-tertiary">
          {msgCount}
        </span>
      )}
    </button>
  );
}

// ─── ContactsPanel ────────────────────────────────────────────────────────────

export function ContactsPanel({ panelId }: { panelId?: string }) {
  const contacts = useContacts();
  const selectedContactId = useWorkspace((s) => s.selectedContactId);
  const setSelectedContactId = useWorkspace((s) => s.setSelectedContactId);

  const [query, setQuery] = React.useState("");

  // Auto-select first contact if none is selected and contacts are available
  React.useEffect(() => {
    if (!selectedContactId && contacts.length > 0) {
      setSelectedContactId(contacts[0]!.id);
    }
  }, [contacts, selectedContactId, setSelectedContactId]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return contacts;
    const q = query.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.emails.some((e) => e.toLowerCase().includes(q)) ||
        (c.company ?? "").toLowerCase().includes(q),
    );
  }, [contacts, query]);

  const selectedContact = React.useMemo(
    () => contacts.find((c) => c.id === selectedContactId) ?? null,
    [contacts, selectedContactId],
  );

  const handleNewContact = () => {
    const id = `contact-new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const contact = {
      id,
      vaultId: localStore.vault?.id ?? "local",
      name: "New Contact",
      emails: [],
      phones: [],
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertContact(contact);
    setSelectedContactId(id);
  };

  const effectivePanelId = panelId ?? "contacts";

  const headerActions = (
    <Button variant="ghost" size="sm" iconOnly aria-label="New contact" onClick={handleNewContact}>
      <UserPlus />
    </Button>
  );

  if (contacts.length === 0) {
    return (
      <Panel
        panelId={effectivePanelId}
        type="inspector"
        header={<PanelHeader title="Contacts" actions={headerActions} />}
      >
        <PanelEmpty
          icon={Users}
          title="No contacts yet"
          body="Contacts appear here automatically as you receive email. You can also add them manually."
          action={
            <Button variant="secondary" size="sm" onClick={handleNewContact}>
              <UserPlus />
              New contact
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <Panel
      panelId={effectivePanelId}
      type="inspector"
      header={<PanelHeader title="Contacts" meta={String(contacts.length)} actions={headerActions} />}
    >
      <div className="flex h-full min-h-0">
        {/* Left column — contact list */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border-subtle">
          {/* Search */}
          <div className="border-b border-border-subtle p-2">
            <div className="relative flex items-center">
              <Search
                size={13}
                className="pointer-events-none absolute left-2 text-text-tertiary"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search contacts…"
                className={cn(
                  "w-full rounded-sm bg-surface-2 pl-7 pr-2 py-1",
                  "font-sans text-small text-text-primary placeholder:text-text-muted",
                  "border border-border-default",
                  "focus:border-accent focus:outline-none",
                )}
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-small text-text-tertiary">
                No results for &ldquo;{query}&rdquo;
              </div>
            ) : (
              filtered.map((c) => (
                <ContactRow
                  key={c.id}
                  contactId={c.id}
                  name={c.name}
                  primaryEmail={c.emails[0] ?? ""}
                  isSelected={c.id === selectedContactId}
                  onSelect={() => setSelectedContactId(c.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right column — detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedContact ? (
            <ContactCard
              email={selectedContact.emails[0] ?? ""}
              name={selectedContact.name}
              compact={false}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-small text-text-tertiary">
              Select a contact
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

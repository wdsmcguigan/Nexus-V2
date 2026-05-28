import * as React from "react";
import { Search, UserPlus, Users, ChevronLeft } from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { ContactCard } from "@/components/contacts/ContactCard";
import { ContactGroupsSidebar } from "@/components/contacts/ContactGroupsSidebar";
import { useContacts, useContactGroups, useContactMessageCount } from "@/storage/useStore";
import { useWorkspace } from "@/state/workspace";
import { upsertContact, recordMutation } from "@/state/mutations";
import { localStore } from "@/storage/local";
import type { Contact } from "@/data/types";
import { pickPanelLink } from "@/design-system/tokens";
import { cn } from "@/lib/utils";

// ─── Row component ────────────────────────────────────────────────────────────

function ContactRow({
  contactId,
  name,
  primaryEmail,
  photoUrl,
  isSelected,
  onSelect,
  onMessageCountClick,
}: {
  contactId: string;
  name: string;
  primaryEmail: string;
  photoUrl?: string;
  isSelected: boolean;
  onSelect: () => void;
  onMessageCountClick?: (modifierKey: boolean) => void;
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
      <Avatar name={name} size={32} colorSeed={colorSeed} src={photoUrl} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body-strong">{name}</div>
        <div className="truncate font-mono text-mono-xs text-text-tertiary">
          {primaryEmail}
        </div>
      </div>
      {msgCount > 0 && (
        <Tooltip label="Show emails with this contact">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onMessageCountClick?.(e.metaKey || e.ctrlKey); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onMessageCountClick?.(false); } }}
            className="shrink-0 cursor-pointer rounded-full bg-surface-3 px-1.5 py-0.5 font-mono text-mono-xs text-text-tertiary hover:bg-accent/20 hover:text-accent"
          >
            {msgCount}
          </span>
        </Tooltip>
      )}
    </button>
  );
}

// ─── Placeholder row (for participant emails with no saved contact) ────────────

function ParticipantPlaceholderRow({
  email,
  isSelected,
  onSelect,
}: {
  email: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const colorSeed = pickPanelLink(email);
  const initials = email.split("@")[0] ?? email;
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-xs px-3 py-2 text-left transition-colors",
        isSelected ? "bg-accent/10 text-text-primary" : "hover:bg-surface-2 text-text-primary",
      )}
    >
      <Avatar name={initials} size={32} colorSeed={colorSeed} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-mono-xs text-text-tertiary">{email}</div>
        <div className="text-caption text-text-muted">Not in contacts</div>
      </div>
    </button>
  );
}

// ─── ContactsPanel ────────────────────────────────────────────────────────────

export function ContactsPanel({ panelId }: { panelId?: string }) {
  const contacts = useContacts();
  const groups = useContactGroups();
  const selectedContactId = useWorkspace((s) => s.selectedContactId);
  const setSelectedContactId = useWorkspace((s) => s.setSelectedContactId);
  const participantFilter = useWorkspace((s) => s.contactParticipantFilter);
  const setParticipantFilter = useWorkspace((s) => s.setContactParticipantFilter);
  const openContactMessages = useWorkspace((s) => s.openContactMessages);

  const [query, setQuery] = React.useState("");
  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);

  const isScoped = participantFilter !== null && participantFilter.length > 0;

  const scopedList = React.useMemo(() => {
    if (!isScoped) return null;
    return participantFilter!.map((email) => {
      const contact = localStore.lookupByEmail(email);
      return { email, contact };
    }).filter((entry, idx, arr) =>
      arr.findIndex((x) => x.email === entry.email) === idx
    );
  }, [isScoped, participantFilter]);

  const filteredContacts = React.useMemo(() => {
    let list = contacts;

    // Group filter
    if (selectedGroupId === "__vip") {
      list = list.filter((c) => c.importance === "vip");
    } else if (selectedGroupId !== null) {
      const memberIds = new Set(
        Array.from(localStore.groupsByContact.entries())
          .filter(([, gids]) => gids.has(selectedGroupId))
          .map(([cid]) => cid)
      );
      list = list.filter((c) => memberIds.has(c.id));
    }

    // Search filter
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.emails.some((e) => e.toLowerCase().includes(q)) ||
          (c.company ?? "").toLowerCase().includes(q),
      );
    }

    return list;
  }, [contacts, selectedGroupId, query]);

  const selectedContact = React.useMemo(
    () => contacts.find((c) => c.id === selectedContactId) ?? null,
    [contacts, selectedContactId],
  );

  const handleNewContact = () => {
    const id = `contact-new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const contact: Contact = {
      id,
      vaultId: localStore.vault?.id ?? "local",
      name: "New Contact",
      emails: [],
      phones: [],
      tags: [],
      socialProfiles: [],
      addresses: [],
      source: "manual",
      importance: "normal",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    upsertContact(contact);
    setSelectedContactId(id);
  };

  const handleCreateGroup = (name: string) => {
    const id = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    recordMutation("CREATE_CONTACT_GROUP", {
      group: {
        id,
        vaultId: localStore.vault?.id ?? "local",
        name,
        position: groups.length,
        createdAt: Date.now(),
      },
    });
  };

  const handleRenameGroup = (id: string, name: string) => {
    const g = localStore.contactGroups.get(id);
    if (!g) return;
    recordMutation("UPDATE_CONTACT_GROUP", { group: { ...g, name } });
  };

  const handleDeleteGroup = (id: string) => {
    recordMutation("DELETE_CONTACT_GROUP", { groupId: id });
    if (selectedGroupId === id) setSelectedGroupId(null);
  };

  const effectivePanelId = panelId ?? "contacts";

  const headerActions = (
    <Button variant="ghost" size="sm" iconOnly aria-label="New contact" onClick={handleNewContact}>
      <UserPlus />
    </Button>
  );

  if (!isScoped && contacts.length === 0) {
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
      header={
        <PanelHeader
          title="Contacts"
          meta={isScoped ? `${scopedList!.length} participants` : String(contacts.length)}
          actions={headerActions}
        />
      }
    >
      <div className="flex h-full min-h-0">
        {/* Column 1 — groups rail (hidden in scoped mode) */}
        {!isScoped && (
          <ContactGroupsSidebar
            groups={groups}
            selectedGroupId={selectedGroupId}
            onSelectGroup={setSelectedGroupId}
            onCreateGroup={handleCreateGroup}
            onRenameGroup={handleRenameGroup}
            onDeleteGroup={handleDeleteGroup}
          />
        )}

        {/* Column 2 — contact list */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border-subtle">
          {/* Scoped mode banner */}
          {isScoped ? (
            <div className="flex items-center gap-1 border-b border-border-subtle bg-surface-2 px-2 py-1.5">
              <button
                type="button"
                onClick={() => setParticipantFilter(null)}
                className="flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-caption text-text-tertiary hover:bg-surface-3 hover:text-text-secondary"
              >
                <ChevronLeft size={11} />
                All contacts
              </button>
            </div>
          ) : (
            <div className="border-b border-border-subtle p-2">
              <div className="relative flex items-center">
                <Search size={13} className="pointer-events-none absolute left-2 text-text-tertiary" />
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
          )}

          <div className="flex-1 overflow-y-auto p-1">
            {isScoped ? (
              scopedList!.map(({ email, contact }) =>
                contact ? (
                  <ContactRow
                    key={email}
                    contactId={contact.id}
                    name={contact.name}
                    primaryEmail={(contact.emails ?? [])[0] ?? email}
                    photoUrl={contact.photoUrl}
                    isSelected={contact.id === selectedContactId}
                    onSelect={() => setSelectedContactId(contact.id)}
                    onMessageCountClick={(mod) => openContactMessages(contact.id, mod)}
                  />
                ) : (
                  <ParticipantPlaceholderRow
                    key={email}
                    email={email}
                    isSelected={false}
                    onSelect={() => {}}
                  />
                )
              )
            ) : filteredContacts.length === 0 ? (
              <div className="py-6 text-center text-small text-text-tertiary">
                {query ? `No results for "${query}"` : "No contacts in this group"}
              </div>
            ) : (
              filteredContacts.map((c) => (
                <ContactRow
                  key={c.id}
                  contactId={c.id}
                  name={c.name}
                  primaryEmail={(c.emails ?? [])[0] ?? ""}
                  photoUrl={c.photoUrl}
                  isSelected={c.id === selectedContactId}
                  onSelect={() => setSelectedContactId(c.id)}
                  onMessageCountClick={(mod) => openContactMessages(c.id, mod)}
                />
              ))
            )}
          </div>
        </div>

        {/* Column 3 — detail */}
        <div className="flex-1 overflow-y-auto">
          {selectedContact ? (
            <ContactCard
              email={(selectedContact.emails ?? [])[0] ?? ""}
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

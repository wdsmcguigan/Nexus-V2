import * as React from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import { Mail, Building2, Star, MessageSquare, Pencil } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { useContactByEmail, useContactMessageCount, useContactMessages } from "@/storage/useStore";
import { useWorkspace } from "@/state/workspace";
import { upsertContact } from "@/state/mutations";
import { localStore } from "@/storage/local";
import { pickPanelLink } from "@/design-system/tokens";
import { cn, formatRelativeTime } from "@/lib/utils";

interface Props {
  email: string;
  name: string;
  children: React.ReactNode;
}

export function ContactHoverCard({ email, name, children }: Props) {
  return (
    <HoverCard.Root openDelay={400} closeDelay={200}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className={cn(
            "z-50 w-72 rounded-lg border border-border-subtle bg-surface-2 shadow-xl",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <CardContent email={email} name={name} />
          <HoverCard.Arrow className="fill-border-subtle" />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

function CardContent({ email, name }: { email: string; name: string }) {
  const contact = useContactByEmail(email);
  const openContactsPanel = useWorkspace((s) => s.openContactsPanel);
  const openComposer = useWorkspace((s) => s.openComposer);
  const colorSeed = pickPanelLink(email);
  const displayName = contact?.name ?? name;

  if (!contact) {
    return <NoContactContent email={email} name={name} colorSeed={colorSeed} />;
  }

  return <FoundContactContent contact={contact} email={email} displayName={displayName} colorSeed={colorSeed} onOpenContact={() => openContactsPanel(contact.id)} onCompose={() => openComposer({ prefilledTo: [email] })} />;
}

function NoContactContent({
  email,
  name,
  colorSeed,
}: {
  email: string;
  name: string;
  colorSeed: ReturnType<typeof pickPanelLink>;
}) {
  const openComposer = useWorkspace((s) => s.openComposer);

  const handleSave = () => {
    const id = `contact-${email.replace(/[^a-z0-9]/gi, "-")}`;
    if (localStore.contacts.has(id)) return;
    upsertContact({
      id,
      vaultId: localStore.vault?.id ?? "local",
      name,
      emails: [email],
      phones: [],
      tags: [],
      socialProfiles: [],
      addresses: [],
      source: "manual",
      importance: "normal",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  };

  return (
    <div className="p-3">
      <div className="mb-3 flex items-start gap-3">
        <Avatar name={name} size={48} colorSeed={colorSeed} />
        <div className="min-w-0 flex-1">
          <div className="font-sans text-body-strong text-text-primary">{name}</div>
          <div className="mt-0.5 font-mono text-mono-xs text-text-tertiary truncate">{email}</div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="xs" onClick={handleSave}>
          Save contact
        </Button>
        <Button variant="ghost" size="xs" onClick={() => openComposer({ prefilledTo: [email] })}>
          <Mail size={11} />
          Compose
        </Button>
      </div>
    </div>
  );
}

function FoundContactContent({
  contact,
  email,
  displayName,
  colorSeed,
  onOpenContact,
  onCompose,
}: {
  contact: NonNullable<ReturnType<typeof useContactByEmail>>;
  email: string;
  displayName: string;
  colorSeed: ReturnType<typeof pickPanelLink>;
  onOpenContact: () => void;
  onCompose: () => void;
}) {
  const msgCount = useContactMessageCount(contact.id);
  const recentMessages = useContactMessages(contact.id, 3);
  const now = React.useMemo(() => new Date(), []);

  return (
    <div className="overflow-hidden rounded-lg">
      {/* Header */}
      <div className="p-3">
        <div className="flex items-start gap-3">
          <Avatar name={displayName} size={48} colorSeed={colorSeed} src={contact.photoUrl ?? localStore.accountPhotoUrlForEmail(contact.emails[0])} email={contact.emails[0]} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-sans text-body-strong text-text-primary truncate">{displayName}</span>
              {contact.importance === "vip" && (
                <Star size={11} className="shrink-0 fill-amber-500 text-amber-500" />
              )}
            </div>
            {(contact.title || contact.company) && (
              <div className="mt-0.5 flex items-center gap-1 text-small text-text-secondary">
                <Building2 size={11} className="shrink-0 text-text-tertiary" />
                <span className="truncate">
                  {[contact.title, contact.company].filter(Boolean).join(" · ")}
                </span>
              </div>
            )}
            <div className="mt-0.5 font-mono text-mono-xs text-text-tertiary truncate">{email}</div>
          </div>
        </div>
      </div>

      {/* Message count */}
      {msgCount > 0 && (
        <div className="border-t border-border-subtle px-3 py-2">
          <div className="flex items-center gap-1.5 text-small text-text-tertiary">
            <MessageSquare size={11} />
            <span>{msgCount} email{msgCount !== 1 ? "s" : ""}</span>
            {recentMessages[0] && (
              <>
                <span>·</span>
                <span>last {formatRelativeTime(new Date(recentMessages[0].receivedAt), now)}</span>
              </>
            )}
          </div>
          {recentMessages.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {recentMessages.map((msg) => (
                <div key={msg.id} className="flex items-baseline gap-2 text-caption">
                  <span className="flex-1 truncate text-text-secondary">{msg.subject || "(no subject)"}</span>
                  <span className="shrink-0 text-text-muted">
                    {formatRelativeTime(new Date(msg.receivedAt), now)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 border-t border-border-subtle px-3 py-2">
        <Button variant="ghost" size="xs" onClick={onCompose}>
          <Mail size={11} />
          Compose
        </Button>
        <Button variant="ghost" size="xs" onClick={onOpenContact}>
          <Pencil size={11} />
          Open contact
        </Button>
      </div>
    </div>
  );
}

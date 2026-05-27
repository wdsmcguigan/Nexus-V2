import * as React from "react";
import {
  Pin,
  PinOff,
  Reply,
  ReplyAll,
  Forward,
  Archive,
  Trash2,
  MoreHorizontal,
  MailQuestion,
  MailOpen,
  BellOff,
  Bell,
  Folder,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import { Tooltip } from "@/components/ui/Tooltip";
import { SnoozePopover } from "@/components/email/SnoozePopover";
import { useInspectorEmailId, useWorkspace } from "@/state/workspace";
import { useMessage, useLabels } from "@/storage/useStore";
import { localStore } from "@/storage/local";
import * as Mut from "@/state/mutations";
import { TagBar } from "@/components/inspector/TagBar";
import { StatusPicker } from "@/components/inspector/StatusPicker";
import { PriorityPicker } from "@/components/inspector/PriorityPicker";
import { StarPalette } from "@/components/inspector/StarPalette";
import { LabelCombobox } from "@/components/inspector/LabelCombobox";
import { FlagPicker } from "@/components/inspector/FlagPicker";
import { NoteEditor } from "@/components/inspector/NoteEditor";
import { CustomFieldStrip } from "@/components/customfields/CustomFieldStrip";
import { FolderPickerDialog } from "@/components/email/FolderPickerDialog";
import { Avatar } from "@/components/ui/Avatar";
import { cn, formatAbsoluteTime, formatBytes } from "@/lib/utils";
import { pickPanelLink, type PanelLink } from "@/design-system/tokens";

function Section({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-b border-border-subtle px-4 py-3", className)}>
      <div className="mb-2 text-overline uppercase text-text-tertiary">{label}</div>
      {children}
    </section>
  );
}

// ─── Participant row ──────────────────────────────────────────────────────────

function ParticipantRow({
  email,
  name,
  role,
  allParticipantEmails,
}: {
  email: string;
  name: string;
  role: "from" | "to" | "cc";
  allParticipantEmails: string[];
}) {
  const openContactsPanel = useWorkspace((s) => s.openContactsPanel);
  const contact = localStore.lookupByEmail(email);
  const colorSeed = pickPanelLink(email);
  const displayName = contact?.name ?? name;

  return (
    <div className="flex items-center gap-2 py-1">
      <Avatar name={displayName} size={24} colorSeed={colorSeed} src={contact?.photoUrl} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-small text-text-primary">{displayName}</div>
        <div className="truncate font-mono text-mono-xs text-text-tertiary">{email}</div>
      </div>
      {role !== "from" && (
        <span className="shrink-0 font-mono text-mono-xs text-text-muted">{role}</span>
      )}
      <button
        type="button"
        aria-label={`Open contact: ${displayName}`}
        onClick={() => openContactsPanel(contact?.id, allParticipantEmails)}
        className="shrink-0 rounded-xs border border-border-subtle px-1.5 py-0.5 font-sans text-[10px] font-medium text-text-tertiary hover:border-border-default hover:bg-surface-3 hover:text-text-secondary transition-colors duration-fast"
      >
        Open Contact
      </button>
    </div>
  );
}

export function InspectorPanel({ panelId }: { panelId?: string }) {
  const pinned = useWorkspace((s) => s.inspectorPinned);
  const togglePin = useWorkspace((s) => s.togglePin);
  const setPinned = useWorkspace((s) => s.setPinned);
  const setMuted = useWorkspace((s) => s.setMuted);
  const removeLabel = useWorkspace((s) => s.removeLabel);
  const openComposer = useWorkspace((s) => s.openComposer);
  const [folderPickerOpen, setFolderPickerOpen] = React.useState(false);

  // When this inspector panel was opened from a specific viewer, show that
  // viewer's effective email rather than the globally-selected one.
  const viewerInspectorMap = useWorkspace((s) => s.viewerInspectorMap);
  const viewerPinState = useWorkspace((s) => s.viewerPinState);
  const globalSelectedEmailId = useWorkspace((s) => s.selectedEmailId);
  const globalInspectorEmailId = useInspectorEmailId();

  const associatedViewerId = panelId
    ? (Object.entries(viewerInspectorMap).find(([, iid]) => iid === panelId)?.[0] ?? null)
    : null;

  const inspectorEmailId = associatedViewerId
    ? (viewerPinState[associatedViewerId] ?? globalSelectedEmailId)
    : globalInspectorEmailId;

  const msg = useMessage(inspectorEmailId);
  const allLabels = useLabels();

  // Per-viewer inspector panels don't show the global pin toggle — the
  // associated viewer already has its own pin button.
  const headerActions = (
    <>
      {!associatedViewerId && (
        <Tooltip label={pinned ? "Unpin inspector" : "Pin inspector to current"} shortcut="P">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-pressed={pinned}
            aria-label={pinned ? "Unpin" : "Pin"}
            onClick={togglePin}
            className={cn(pinned && "text-accent hover:text-accent")}
          >
            {pinned ? <Pin /> : <PinOff />}
          </Button>
        </Tooltip>
      )}
      <Tooltip label="More">
        <Button variant="ghost" size="sm" iconOnly aria-label="More">
          <MoreHorizontal />
        </Button>
      </Tooltip>
    </>
  );

  const effectivePanelId = panelId ?? "inspector";

  if (!msg) {
    return (
      <Panel
        panelId={effectivePanelId}
        type="inspector"
        header={<PanelHeader title="Inspector" actions={headerActions} />}
        data-pinned={pinned}
      >
        <PanelEmpty
          icon={MailQuestion}
          title="Nothing to inspect"
          body="Select an email to see metadata, contacts, and quick actions here."
        />
      </Panel>
    );
  }

  const msgLabels = allLabels.filter((l) => msg.labelIds.includes(l.id));

  return (
    <Panel
      panelId={effectivePanelId}
      type="inspector"
      header={
        <PanelHeader
          title={pinned ? "Inspector (pinned)" : "Inspector"}
          actions={headerActions}
        />
      }
      data-pinned={pinned}
    >
      <div data-scroll className="nx-scroll h-full overflow-auto">
        {/* All envelope participants */}
        {(() => {
          const allEmails = [
            msg.fromAddr.email,
            ...msg.toAddrs.map((t) => t.email),
            ...msg.ccAddrs.map((t) => t.email),
          ];
          return (
            <Section label="Participants">
              <ParticipantRow
                key={msg.fromAddr.email}
                email={msg.fromAddr.email}
                name={msg.fromAddr.name}
                role="from"
                allParticipantEmails={allEmails}
              />
              {msg.toAddrs.map((t) => (
                <ParticipantRow
                  key={t.email}
                  email={t.email}
                  name={t.name}
                  role="to"
                  allParticipantEmails={allEmails}
                />
              ))}
              {msg.ccAddrs.map((t) => (
                <ParticipantRow
                  key={t.email}
                  email={t.email}
                  name={t.name}
                  role="cc"
                  allParticipantEmails={allEmails}
                />
              ))}
            </Section>
          );
        })()}

        <Section label="Date">
          <div className="font-mono text-mono-sm text-text-secondary">
            {formatAbsoluteTime(new Date(msg.receivedAt))}
          </div>
        </Section>

        {/* Quick actions */}
        <Section label="Actions">
          <div className="grid grid-cols-2 gap-1">
            <Button variant="secondary" size="sm" onClick={() => openComposer({ mode: "reply", replyToMessage: msg })}>
              <Reply />
              Reply
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openComposer({ mode: "reply-all", replyToMessage: msg })}>
              <ReplyAll />
              Reply all
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openComposer({ mode: "forward", replyToMessage: msg })}>
              <Forward />
              Forward
            </Button>
            <Button variant="secondary" size="sm" onClick={() => Mut.archiveMessage(localStore, msg.id)}>
              <Archive />
              Archive
            </Button>
            <SnoozePopover messageId={msg.id} variant="inline" />
            <Button variant="secondary" size="sm" onClick={() => Mut.deleteMessage(localStore, msg.id)}>
              <Trash2 />
              Delete
            </Button>
            <Button variant="secondary" size="sm" onClick={() => Mut.unreadMessage(localStore, msg.id)}>
              <MailOpen />
              Mark unread
            </Button>
          </div>
        </Section>

        {/* INS-PIN-TOGGLE / INS-MUTE-TOGGLE */}
        <Section label="Flags">
          <div className="flex flex-wrap gap-2">
            <Tooltip label={msg.pinned ? "Unpin message" : "Pin message"}>
              <Button
                variant={msg.pinned ? "primary" : "secondary"}
                size="sm"
                aria-pressed={msg.pinned}
                onClick={() => setPinned(msg.id, !msg.pinned)}
              >
                {msg.pinned ? <Pin /> : <PinOff />}
                {msg.pinned ? "Pinned" : "Pin"}
              </Button>
            </Tooltip>
            <Tooltip label={msg.muted ? "Unmute thread" : "Mute thread"}>
              <Button
                variant={msg.muted ? "primary" : "secondary"}
                size="sm"
                aria-pressed={msg.muted}
                onClick={() => setMuted(msg.id, !msg.muted)}
              >
                {msg.muted ? <BellOff /> : <Bell />}
                {msg.muted ? "Muted" : "Mute"}
              </Button>
            </Tooltip>
          </div>
        </Section>

        {/* INS-FLAG-PICKER — full follow-up picker (EP-2) */}
        <Section label="Follow-up">
          <FlagPicker messageId={msg.id} flag={msg.flag} />
        </Section>

        {/* Star */}
        <Section label="Star">
          <div className="flex items-center gap-2">
            <StarPalette messageId={msg.id} star={msg.star} />
            <span className="text-small text-text-tertiary">
              {msg.star ? msg.star.replace(/-/g, " ") : "No star"}
            </span>
          </div>
        </Section>

        {/* Status + Priority */}
        <Section label="Workflow">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-16 text-small text-text-tertiary">Status</span>
              <StatusPicker messageId={msg.id} statusId={msg.statusId} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-16 text-small text-text-tertiary">Priority</span>
              <PriorityPicker messageId={msg.id} priority={msg.priority} />
            </div>
          </div>
        </Section>

        {/* INS-TAG-BAR */}
        <Section label="Tags">
          <TagBar messageId={msg.id} tags={msg.tags} />
        </Section>

        {/* INS-LBL-COMBO */}
        <Section label="Labels">
          <div className="flex flex-wrap gap-1">
            {msgLabels.map((l) => (
              <Tag
                key={l.id}
                color={l.color as PanelLink}
                size="md"
                removable
                onRemove={() => removeLabel(msg.id, l.id)}
              >
                {l.name}
              </Tag>
            ))}
            {msgLabels.length === 0 && (
              <span className="text-small text-text-tertiary">No labels</span>
            )}
          </div>
          <div className="mt-2">
            <LabelCombobox messageId={msg.id} activeLabelIds={msg.labelIds} />
          </div>
        </Section>

        {/* INS-FOLDER */}
        <Section label="Folder">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Folder size={13} className="shrink-0 text-text-tertiary" />
              <span className="truncate text-small text-text-secondary">
                {localStore.folders.get(msg.folderId)?.name ?? msg.folderId}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setFolderPickerOpen(true)}
              className="shrink-0 rounded-xs border border-border-subtle px-1.5 py-0.5 font-sans text-[10px] font-medium text-text-tertiary hover:border-border-default hover:bg-surface-3 hover:text-text-secondary transition-colors duration-fast"
            >
              Move…
            </button>
          </div>
        </Section>

        {/* INS-CUSTOM-FIELDS — per-message editors (EP-2) */}
        <Section label="Custom Fields">
          <CustomFieldStrip messageId={msg.id} customFields={msg.customFields} />
        </Section>

        {/* INS-NOTE-EDITOR — markdown note (EP-2) */}
        <Section label="Notes">
          <NoteEditor messageId={msg.id} notes={msg.notes} />
        </Section>

        {/* Attachments */}
        {msg.attachmentRefs.length > 0 && (
          <Section label="Attachments">
            <div className="space-y-1">
              {msg.attachmentRefs.map((a) => (
                <div
                  key={a.name}
                  className="flex items-center justify-between gap-2 rounded-xs bg-surface-2 px-2 py-1.5"
                >
                  <span className="truncate text-small text-text-primary">{a.name}</span>
                  <span className="shrink-0 font-mono text-mono-xs text-text-tertiary">
                    {formatBytes(a.size)}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Thread info */}
        <Section label="Thread">
          <div className="text-small text-text-secondary">
            Thread {msg.threadId.slice(0, 12)}…
          </div>
        </Section>
      </div>
      <FolderPickerDialog
        messageId={msg.id}
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
      />
    </Panel>
  );
}

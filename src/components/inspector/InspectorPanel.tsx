import * as React from "react";
import {
  Pin,
  PinOff,
  Reply,
  Forward,
  AlarmClock,
  Archive,
  Trash2,
  Copy,
  ExternalLink,
  MoreHorizontal,
  MailQuestion,
  BellOff,
  Bell,
  Flag,
  FlagOff,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import { Tooltip } from "@/components/ui/Tooltip";
import { useInspectorEmailId, useWorkspace } from "@/state/workspace";
import { useMessage, useLabels } from "@/storage/useStore";
import { TagBar } from "@/components/inspector/TagBar";
import { StatusPicker } from "@/components/inspector/StatusPicker";
import { PriorityPicker } from "@/components/inspector/PriorityPicker";
import { StarPalette } from "@/components/inspector/StarPalette";
import { LabelCombobox } from "@/components/inspector/LabelCombobox";
import { pickPanelLink } from "@/design-system/tokens";
import { cn, formatAbsoluteTime, formatBytes } from "@/lib/utils";

const PANEL_ID = "inspector";

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

export function InspectorPanel() {
  const pinned = useWorkspace((s) => s.inspectorPinned);
  const togglePin = useWorkspace((s) => s.togglePin);
  const setPinned = useWorkspace((s) => s.setPinned);
  const setMuted = useWorkspace((s) => s.setMuted);
  const setFlag = useWorkspace((s) => s.setFlag);
  const clearFlag = useWorkspace((s) => s.clearFlag);
  const removeLabel = useWorkspace((s) => s.removeLabel);

  const inspectorEmailId = useInspectorEmailId();
  const msg = useMessage(inspectorEmailId);
  const allLabels = useLabels();

  const headerActions = (
    <>
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
      <Tooltip label="More">
        <Button variant="ghost" size="sm" iconOnly aria-label="More">
          <MoreHorizontal />
        </Button>
      </Tooltip>
    </>
  );

  if (!msg) {
    return (
      <Panel
        panelId={PANEL_ID}
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

  const fromColorSeed = pickPanelLink(msg.fromAddr.email);
  const msgLabels = allLabels.filter((l) => msg.labelIds.includes(l.id));

  return (
    <Panel
      panelId={PANEL_ID}
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
        {/* Sender card */}
        <Section label="From">
          <div className="flex items-start gap-3">
            <Avatar name={msg.fromAddr.name} size={40} colorSeed={fromColorSeed} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-body-strong text-text-primary">
                {msg.fromAddr.name}
              </div>
              <div className="mt-0.5 flex items-center gap-1">
                <span className="truncate font-mono text-mono-sm text-text-tertiary">
                  {msg.fromAddr.email}
                </span>
                <Tooltip label="Copy address">
                  <button
                    aria-label="Copy address"
                    className="rounded-xs p-0.5 text-text-tertiary opacity-dim hover:opacity-full focus-visible:opacity-full focus-visible:shadow-focus"
                  >
                    <Copy size={11} />
                  </button>
                </Tooltip>
              </div>
              <div className="mt-2 flex items-center gap-1">
                <Button variant="ghost" size="xs">
                  <ExternalLink />
                  Open contact
                </Button>
              </div>
            </div>
          </div>
        </Section>

        {/* Recipients */}
        <Section label="To">
          <div className="space-y-1 text-small text-text-secondary">
            {msg.toAddrs.map((t) => (
              <div key={t.email} className="flex items-baseline gap-2">
                <span>{t.name}</span>
                <span className="font-mono text-mono-xs text-text-tertiary">{t.email}</span>
              </div>
            ))}
            {msg.ccAddrs.map((t) => (
              <div key={t.email} className="flex items-baseline gap-2">
                <span className="text-text-tertiary">cc</span>
                <span>{t.name}</span>
                <span className="font-mono text-mono-xs text-text-tertiary">{t.email}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section label="Date">
          <div className="font-mono text-mono-sm text-text-secondary">
            {formatAbsoluteTime(new Date(msg.receivedAt))}
          </div>
        </Section>

        {/* Quick actions */}
        <Section label="Actions">
          <div className="grid grid-cols-2 gap-1">
            <Button variant="secondary" size="sm">
              <Reply />
              Reply
            </Button>
            <Button variant="secondary" size="sm">
              <Forward />
              Forward
            </Button>
            <Button variant="secondary" size="sm" onClick={() => useWorkspace.getState().archive(msg.id)}>
              <Archive />Archive
            </Button>
            <Button variant="secondary" size="sm">
              <AlarmClock />
              Snooze
            </Button>
            <Button variant="secondary" size="sm">
              <Trash2 />
              Delete
            </Button>
          </div>
        </Section>

        {/* INS-PIN-TOGGLE / INS-MUTE-TOGGLE / INS-FLAG-TOGGLE */}
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
            <Tooltip label={msg.flag ? "Remove flag" : "Flag for follow-up"}>
              <Button
                variant={msg.flag ? "primary" : "secondary"}
                size="sm"
                aria-pressed={!!msg.flag}
                onClick={() => {
                  if (msg.flag) clearFlag(msg.id);
                  else setFlag(msg.id, { setAt: Date.now() });
                }}
              >
                {msg.flag ? <Flag /> : <FlagOff />}
                {msg.flag ? "Flagged" : "Flag"}
              </Button>
            </Tooltip>
          </div>
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
                color={l.color as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}
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
    </Panel>
  );
}

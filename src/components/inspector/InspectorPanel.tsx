import * as React from "react";
import {
  Pin,
  PinOff,
  Reply,
  Forward,
  AlarmClock,
  Star,
  Archive,
  Trash2,
  Tags,
  Copy,
  ExternalLink,
  MoreHorizontal,
  MailQuestion,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import { Tooltip } from "@/components/ui/Tooltip";
import { useInspectorEmailId, useWorkspace, useEmail } from "@/state/workspace";
import { useIsMobile } from "@/lib/useMediaQuery";
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
    <section
      className={cn("border-b border-border-subtle px-4 py-3", className)}
    >
      <div className="mb-2 text-overline uppercase text-text-tertiary">
        {label}
      </div>
      {children}
    </section>
  );
}

export function InspectorPanel() {
  const pinned = useWorkspace((s) => s.inspectorPinned);
  const togglePin = useWorkspace((s) => s.togglePin);
  const setComposerOpen = useWorkspace((s) => s.setComposerOpen);
  const setStarred = useWorkspace((s) => s.setStarred);
  const archive = useWorkspace((s) => s.archive);
  const snooze = useWorkspace((s) => s.snooze);
  const deleteEmails = useWorkspace((s) => s.deleteEmails);
  const removeLabelFromEmail = useWorkspace((s) => s.removeLabelFromEmail);
  const inspectorEmailId = useInspectorEmailId();
  const email = useEmail(inspectorEmailId);
  const isMobile = useIsMobile();

  const headerActions = isMobile ? null : (
    <>
      <Tooltip
        label={pinned ? "Unpin inspector" : "Pin inspector to current"}
        shortcut="P"
      >
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

  if (!email) {
    return (
      <Panel
        panelId={PANEL_ID}
        type="inspector"
        header={
          isMobile ? undefined : (
            <PanelHeader title="Inspector" actions={headerActions} />
          )
        }
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

  return (
    <Panel
      panelId={PANEL_ID}
      type="inspector"
      header={
        isMobile ? undefined : (
          <PanelHeader
            title={pinned ? "Inspector (pinned)" : "Inspector"}
            actions={headerActions}
          />
        )
      }
      data-pinned={pinned}
    >
      <div data-scroll className="nx-scroll h-full overflow-auto">
        {/* Sender card */}
        <Section label="From">
          <div className="flex items-start gap-3">
            <Avatar
              name={email.from.name}
              size={40}
              colorSeed={email.from.colorSeed}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-body-strong text-text-primary">
                {email.from.name}
              </div>
              <div className="mt-0.5 flex items-center gap-1">
                <span className="truncate font-mono text-mono-sm text-text-tertiary">
                  {email.from.email}
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
            {email.to.map((t) => (
              <div key={t.email} className="flex items-baseline gap-2">
                <span>{t.name}</span>
                <span className="font-mono text-mono-xs text-text-tertiary">
                  {t.email}
                </span>
              </div>
            ))}
            {email.cc?.map((t) => (
              <div key={t.email} className="flex items-baseline gap-2">
                <span className="text-text-tertiary">cc</span>
                <span>{t.name}</span>
                <span className="font-mono text-mono-xs text-text-tertiary">
                  {t.email}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section label="Date">
          <div className="font-mono text-mono-sm text-text-secondary">
            {formatAbsoluteTime(email.receivedAt)}
          </div>
        </Section>

        {/* Quick actions */}
        <Section label="Actions">
          <div className="grid grid-cols-2 gap-1">
            <Button variant="secondary" size="sm" onClick={() => setComposerOpen(true)}>
              <Reply />
              Reply
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setComposerOpen(true)}>
              <Forward />
              Forward
            </Button>
            <Button variant="secondary" size="sm" onClick={() => archive([email.id])}>
              <Archive />
              Archive
            </Button>
            <Button variant="secondary" size="sm" onClick={() => snooze([email.id])}>
              <AlarmClock />
              Snooze
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setStarred(email.id, !email.starred)}
              aria-pressed={email.starred}
            >
              <Star
                fill={email.starred ? "var(--color-warning)" : "transparent"}
                color={email.starred ? "var(--color-warning)" : "currentColor"}
              />
              {email.starred ? "Starred" : "Star"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => deleteEmails([email.id])}>
              <Trash2 />
              Delete
            </Button>
          </div>
        </Section>

        {/* Labels */}
        <Section label="Labels">
          <div className="flex flex-wrap gap-1">
            {email.labels.length === 0 && (
              <span className="text-small text-text-tertiary">No labels</span>
            )}
            {email.labels.map((l) => (
              <Tag
                key={l.id}
                color={l.color}
                size="md"
                removable
                onRemove={() => removeLabelFromEmail(email.id, l.id)}
              >
                {l.name}
              </Tag>
            ))}
            <Button variant="ghost" size="xs">
              <Tags />
              Add
            </Button>
          </div>
        </Section>

        {/* Attachments */}
        {email.attachments.length > 0 && (
          <Section label="Attachments">
            <div className="space-y-1">
              {email.attachments.map((a) => (
                <div
                  key={a.name}
                  className="flex items-center justify-between gap-2 rounded-xs bg-surface-2 px-2 py-1.5"
                >
                  <span className="truncate text-small text-text-primary">
                    {a.name}
                  </span>
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
            1 message · in {email.folderId}
          </div>
        </Section>
      </div>
    </Panel>
  );
}

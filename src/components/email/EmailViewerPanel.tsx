import * as React from "react";
import {
  Reply,
  ReplyAll,
  Forward,
  MoreHorizontal,
  ShieldCheck,
  ImageIcon,
  Mail,
  Star,
  Archive,
  Trash2,
  AlarmClock,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { PanelEmpty } from "@/components/panel/PanelEmpty";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useWorkspace } from "@/state/workspace";
import { emailById } from "@/data/fixtures";
import { formatAbsoluteTime } from "@/lib/utils";

const PANEL_ID = "viewer";

export function EmailViewerPanel() {
  const selectedEmailId = useWorkspace((s) => s.selectedEmailId);
  const setComposerOpen = useWorkspace((s) => s.setComposerOpen);
  const email = emailById(selectedEmailId);
  const [imagesShown, setImagesShown] = React.useState(false);

  if (!email) {
    return (
      <Panel
        panelId={PANEL_ID}
        type="stage"
        header={<PanelHeader title="Reader" />}
      >
        <PanelEmpty
          icon={Mail}
          title="No message selected"
          body="Choose an email from the list, or press ⌘K to jump to one."
        />
      </Panel>
    );
  }

  // simulate that some emails have remote images
  const hasRemoteImages = email.id.endsWith("0") || email.id.endsWith("5");

  return (
    <Panel
      panelId={PANEL_ID}
      type="stage"
      header={
        <PanelHeader
          title={email.subject}
          actions={
            <>
              <Tooltip label="Star">
                <Button variant="ghost" size="sm" iconOnly aria-label="Star">
                  <Star />
                </Button>
              </Tooltip>
              <Tooltip label="Snooze" shortcut="H">
                <Button variant="ghost" size="sm" iconOnly aria-label="Snooze">
                  <AlarmClock />
                </Button>
              </Tooltip>
              <Tooltip label="Archive" shortcut="E">
                <Button variant="ghost" size="sm" iconOnly aria-label="Archive">
                  <Archive />
                </Button>
              </Tooltip>
              <Tooltip label="Delete" shortcut="#">
                <Button variant="ghost" size="sm" iconOnly aria-label="Delete">
                  <Trash2 />
                </Button>
              </Tooltip>
              <span className="mx-1 h-4 w-px bg-border-subtle" />
              <Tooltip label="More">
                <Button variant="ghost" size="sm" iconOnly aria-label="More">
                  <MoreHorizontal />
                </Button>
              </Tooltip>
            </>
          }
        />
      }
    >
      <div className="flex h-full flex-col">
        {/* Sender chrome (above iframe) */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle bg-surface-1 px-4 py-3">
          <Avatar
            name={email.from.name}
            size={40}
            colorSeed={email.from.colorSeed}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="truncate font-sans text-body-strong text-text-primary">
                {email.from.name}
              </span>
              <span className="truncate font-mono text-mono-sm text-text-tertiary">
                &lt;{email.from.email}&gt;
              </span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-2 text-small text-text-tertiary">
              <span>to {email.to.map((t) => t.name).join(", ")}</span>
              {email.cc && email.cc.length > 0 && (
                <>
                  <span>·</span>
                  <span>cc {email.cc.map((t) => t.name).join(", ")}</span>
                </>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-mono text-mono-sm text-text-secondary">
              {formatAbsoluteTime(email.receivedAt)}
            </div>
            <div className="mt-0.5 flex items-center justify-end gap-1 text-overline uppercase text-text-tertiary">
              <ShieldCheck size={10} />
              <span>isolated content</span>
            </div>
          </div>
        </div>

        {/* Remote-image banner */}
        {hasRemoteImages && !imagesShown && (
          <div className="flex h-8 shrink-0 items-center gap-2 border-b border-warning bg-warning-soft px-4">
            <ImageIcon size={14} className="text-warning" />
            <span className="text-small text-text-primary">
              Remote images blocked
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImagesShown(true)}
              >
                Show images
              </Button>
              <Button variant="ghost" size="sm">
                Always allow
              </Button>
            </div>
          </div>
        )}

        {/* Iframe sandbox boundary */}
        <div
          data-scroll
          className="nx-scroll min-h-0 flex-1 overflow-auto bg-canvas p-4"
        >
          <div className="mx-auto max-w-[680px] rounded-md border border-border-default bg-surface-1 shadow-l1">
            <iframe
              title={`Email body from ${email.from.name}`}
              sandbox=""
              srcDoc={`<!doctype html><html><head><style>
                html,body{margin:0;padding:24px;background:transparent;color:#e6e8ec;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6}
                p{margin:0 0 12px}h1,h2,h3{margin:0 0 12px;color:#fff}ul,ol{margin:0 0 12px 24px}
                strong{color:#fff}a{color:#76A1F5}
              </style></head><body>${email.body}</body></html>`}
              className="block h-[420px] w-full rounded-md bg-canvas"
            />
          </div>
        </div>

        {/* Footer chrome (reply bar) */}
        <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border-subtle bg-surface-1 px-4">
          <Button
            variant="primary"
            size="md"
            onClick={() => setComposerOpen(true)}
          >
            <Reply />
            Reply
          </Button>
          <Button variant="secondary" size="md">
            <ReplyAll />
            Reply all
          </Button>
          <Button variant="secondary" size="md">
            <Forward />
            Forward
          </Button>
        </div>
      </div>
    </Panel>
  );
}

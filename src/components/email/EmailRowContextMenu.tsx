/**
 * Right-click context menu for email rows in the list panel.
 * Wraps children with a Radix ContextMenu; actions mirror the keyboard shortcuts.
 */
import * as React from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  Reply,
  ReplyAll,
  Forward,
  Archive,
  Trash2,
  MailOpen,
  Mail,
  Star,
  StarOff,
  AlarmClock,
  Folder,
  ChevronRight,
  Pin,
  PinOff,
  BellOff,
  Bell,
} from "lucide-react";
import { toast } from "sonner";
import { localStore } from "@/storage/local";
import * as Mut from "@/state/mutations";
import { useWorkspace } from "@/state/workspace";
import { snoozeMessage } from "@/state/mutations";
import { cn } from "@/lib/utils";
import type { Message } from "@/data/types";

// ─── Shared menu item style ───────────────────────────────────────────────────

const itemCls = cn(
  "group relative flex h-7 cursor-default select-none items-center gap-2 rounded-xs px-2 pl-6 text-body outline-none",
  "text-text-secondary data-[highlighted]:bg-surface-3 data-[highlighted]:text-text-primary",
  "transition-colors duration-fast",
);
const destructCls = cn(itemCls, "data-[highlighted]:bg-error/10 data-[highlighted]:text-error");
const separatorCls = "my-1 h-px bg-border-subtle";
const labelCls = "px-6 py-1 text-overline uppercase text-text-muted";
const shortcutCls = "ml-auto font-mono text-mono-xs text-text-muted";

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  message: Message;
  children: React.ReactNode;
  onArchive: () => void;
  onDelete: () => void;
}

export function EmailRowContextMenu({ message: msg, children, onArchive, onDelete }: Props) {
  const openComposer = useWorkspace((s) => s.openComposer);
  const unarchive = useWorkspace((s) => s.unarchive);

  const isRead = msg.flags.read;
  const isStarred = !!msg.star;
  const isPinned = msg.pinned;
  const isMuted = msg.muted;

  function snoozeToTomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    snoozeMessage(localStore, msg.id, d.getTime());
  }

  // Folders for "Move to" submenu
  const folders = Array.from(localStore.folders.values()).filter(
    (f) => !f.systemKind && f.id !== msg.folderId,
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={cn(
            "z-50 min-w-[220px] overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-l3",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          {/* Reply actions */}
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => openComposer({ mode: "reply", replyToMessage: msg })}
          >
            <Reply size={12} className="absolute left-2 text-text-tertiary" />
            Reply
            <span className={shortcutCls}>R</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => openComposer({ mode: "reply-all", replyToMessage: msg })}
          >
            <ReplyAll size={12} className="absolute left-2 text-text-tertiary" />
            Reply all
          </ContextMenu.Item>
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => openComposer({ mode: "forward", replyToMessage: msg })}
          >
            <Forward size={12} className="absolute left-2 text-text-tertiary" />
            Forward
            <span className={shortcutCls}>F</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className={separatorCls} />

          {/* Read / star */}
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => {
              if (isRead) Mut.unreadMessage(localStore, msg.id);
              else Mut.readMessage(localStore, msg.id);
            }}
          >
            {isRead ? (
              <Mail size={12} className="absolute left-2 text-text-tertiary" />
            ) : (
              <MailOpen size={12} className="absolute left-2 text-text-tertiary" />
            )}
            {isRead ? "Mark as unread" : "Mark as read"}
            <span className={shortcutCls}>U</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => {
              if (isStarred) Mut.clearStar(localStore, msg.id);
              else Mut.setStar(localStore, msg.id, "yellow");
            }}
          >
            {isStarred ? (
              <StarOff size={12} className="absolute left-2 text-text-tertiary" />
            ) : (
              <Star size={12} className="absolute left-2 text-text-tertiary" />
            )}
            {isStarred ? "Unstar" : "Star"}
            <span className={shortcutCls}>S</span>
          </ContextMenu.Item>
          <ContextMenu.Item className={itemCls} onSelect={snoozeToTomorrow}>
            <AlarmClock size={12} className="absolute left-2 text-text-tertiary" />
            Snooze to tomorrow
            <span className={shortcutCls}>H</span>
          </ContextMenu.Item>

          <ContextMenu.Separator className={separatorCls} />

          {/* Pin / mute */}
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => Mut.setPinned(localStore, msg.id, !isPinned)}
          >
            {isPinned ? (
              <PinOff size={12} className="absolute left-2 text-text-tertiary" />
            ) : (
              <Pin size={12} className="absolute left-2 text-text-tertiary" />
            )}
            {isPinned ? "Unpin" : "Pin to top"}
          </ContextMenu.Item>
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => Mut.setMuted(localStore, msg.id, !isMuted)}
          >
            {isMuted ? (
              <Bell size={12} className="absolute left-2 text-text-tertiary" />
            ) : (
              <BellOff size={12} className="absolute left-2 text-text-tertiary" />
            )}
            {isMuted ? "Unmute thread" : "Mute thread"}
          </ContextMenu.Item>

          {/* Move to folder submenu */}
          {folders.length > 0 && (
            <>
              <ContextMenu.Separator className={separatorCls} />
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={cn(itemCls, "data-[state=open]:bg-surface-3")}>
                  <Folder size={12} className="absolute left-2 text-text-tertiary" />
                  Move to folder
                  <ChevronRight size={10} className="ml-auto text-text-muted" />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent
                    className={cn(
                      "z-50 min-w-[160px] overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-l3",
                      "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
                    )}
                    sideOffset={4}
                  >
                    <ContextMenu.Label className={labelCls}>Folders</ContextMenu.Label>
                    {folders.map((f) => (
                      <ContextMenu.Item
                        key={f.id}
                        className={itemCls}
                        onSelect={() => Mut.moveToFolder(localStore, msg.id, f.id)}
                      >
                        <Folder size={12} className="absolute left-2 text-text-tertiary" />
                        {f.name}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            </>
          )}

          <ContextMenu.Separator className={separatorCls} />

          {/* Archive / delete */}
          <ContextMenu.Item
            className={itemCls}
            onSelect={() => {
              const id = msg.id;
              onArchive();
              toast("Archived", { action: { label: "Undo", onClick: () => unarchive(id) } });
            }}
          >
            <Archive size={12} className="absolute left-2 text-text-tertiary" />
            Archive
            <span className={shortcutCls}>E</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className={destructCls}
            onSelect={() => {
              onDelete();
              toast("Moved to Trash");
            }}
          >
            <Trash2 size={12} className="absolute left-2" />
            Delete
            <span className={shortcutCls}>#</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

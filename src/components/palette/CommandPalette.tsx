import * as React from "react";
import * as RadixDialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import type { LucideIcon } from "lucide-react";
import {
  Search,
  Inbox,
  Star,
  Send,
  Mail,
  Settings as SettingsIcon,
  PenSquare,
  Pin,
  Archive,
  Trash2,
  Sun,
  Rows3,
  Rows4,
  Rows2,
  Reply,
  Forward,
  AlarmClock,
} from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/Kbd";
import type { Density } from "@/design-system/tokens";

interface CmdItemDef {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  shortcut?: string;
  perform: () => void;
}

export function CommandPalette() {
  const open = useWorkspace((s) => s.paletteOpen);
  const setOpen = useWorkspace((s) => s.setPaletteOpen);
  const setFolder = useWorkspace((s) => s.setSelectedFolder);
  const setComposerOpen = useWorkspace((s) => s.setComposerOpen);
  const togglePin = useWorkspace((s) => s.togglePin);
  const toggleTheme = useWorkspace((s) => s.toggleTheme);
  const setDensity = useWorkspace((s) => s.setDensity);
  const setActivePanel = useWorkspace((s) => s.setActivePanel);
  const previousPanelId = useWorkspace((s) => s.previousPanelId);

  // Restore focus on close — Focus Memory Stack §6.2
  React.useEffect(() => {
    if (!open && previousPanelId) {
      const el = document.querySelector<HTMLElement>(
        `[data-panel-id="${previousPanelId}"]`,
      );
      el?.focus();
    }
  }, [open, previousPanelId]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const items: CmdItemDef[] = React.useMemo(
    () => [
      {
        id: "compose",
        label: "Compose new email",
        group: "Mail",
        icon: PenSquare,
        shortcut: "C",
        perform: () => {
          setComposerOpen(true);
          setActivePanel("composer");
        },
      },
      {
        id: "reply",
        label: "Reply",
        group: "Mail",
        icon: Reply,
        shortcut: "R",
        perform: () => setComposerOpen(true),
      },
      {
        id: "forward",
        label: "Forward",
        group: "Mail",
        icon: Forward,
        shortcut: "F",
        perform: () => setComposerOpen(true),
      },
      {
        id: "archive",
        label: "Archive selected",
        group: "Mail",
        icon: Archive,
        shortcut: "E",
        perform: () => {},
      },
      {
        id: "snooze",
        label: "Snooze selected",
        group: "Mail",
        icon: AlarmClock,
        shortcut: "H",
        perform: () => {},
      },
      {
        id: "delete",
        label: "Delete selected",
        group: "Mail",
        icon: Trash2,
        perform: () => {},
      },
      {
        id: "go-inbox",
        label: "Go to Inbox",
        group: "Navigate",
        icon: Inbox,
        shortcut: "G I",
        perform: () => setFolder("inbox"),
      },
      {
        id: "go-starred",
        label: "Go to Starred",
        group: "Navigate",
        icon: Star,
        shortcut: "G S",
        perform: () => setFolder("starred"),
      },
      {
        id: "go-sent",
        label: "Go to Sent",
        group: "Navigate",
        icon: Send,
        shortcut: "G T",
        perform: () => setFolder("sent"),
      },
      {
        id: "go-snoozed",
        label: "Go to Snoozed",
        group: "Navigate",
        icon: AlarmClock,
        perform: () => setFolder("snoozed"),
      },
      {
        id: "pin",
        label: "Pin / unpin Inspector",
        group: "Workspace",
        icon: Pin,
        shortcut: "P",
        perform: togglePin,
      },
      {
        id: "theme",
        label: "Toggle theme",
        group: "Workspace",
        icon: Sun,
        shortcut: "⌘⇧L",
        perform: toggleTheme,
      },
      {
        id: "density-compact",
        label: "Density: Compact",
        group: "Workspace",
        icon: Rows4,
        perform: () => setDensity("compact" as Density),
      },
      {
        id: "density-comfortable",
        label: "Density: Comfortable",
        group: "Workspace",
        icon: Rows3,
        perform: () => setDensity("comfortable" as Density),
      },
      {
        id: "density-cozy",
        label: "Density: Cozy",
        group: "Workspace",
        icon: Rows2,
        perform: () => setDensity("cozy" as Density),
      },
      {
        id: "settings",
        label: "Open Settings",
        group: "Workspace",
        icon: SettingsIcon,
        shortcut: "⌘,",
        perform: () => {},
      },
    ],
    [setFolder, setComposerOpen, setActivePanel, togglePin, toggleTheme, setDensity],
  );

  const grouped = React.useMemo(() => {
    const map: Record<string, CmdItemDef[]> = {};
    items.forEach((it) => {
      (map[it.group] ??= []).push(it);
    });
    return map;
  }, [items]);

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-canvas/60 backdrop-blur-sm",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <RadixDialog.Content
          aria-label="Command palette"
          className={cn(
            "fixed left-1/2 top-[20vh] z-50 w-[640px] max-w-[92vw] -translate-x-1/2",
            "rounded-xl border border-border-default bg-surface-4 shadow-l3",
            "animate-cmdk-in",
          )}
        >
          <Command label="Command palette" loop>
            <RadixDialog.Title className="sr-only">
              Command palette
            </RadixDialog.Title>
            <RadixDialog.Description className="sr-only">
              Search for commands and navigation actions
            </RadixDialog.Description>
            <div className="flex items-center gap-2 border-b border-border-default px-3">
              <Search size={14} className="text-text-tertiary" />
              <Command.Input
                placeholder="Type a command or search…"
                className={cn(
                  "h-12 w-full bg-transparent font-sans text-body text-text-primary",
                  "placeholder:text-text-muted focus:outline-none",
                )}
              />
              <Kbd size="sm" className="ml-auto">
                Esc
              </Kbd>
            </div>
            <Command.List
              data-scroll
              className="nx-scroll max-h-[420px] overflow-y-auto p-2"
            >
              <Command.Empty className="px-3 py-6 text-center text-small text-text-tertiary">
                No commands match
              </Command.Empty>
              {Object.entries(grouped).map(([group, list]) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className={cn(
                    "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2",
                    "[&_[cmdk-group-heading]]:text-overline [&_[cmdk-group-heading]]:uppercase",
                    "[&_[cmdk-group-heading]]:text-text-tertiary",
                  )}
                >
                  {list.map((it) => (
                    <Command.Item
                      key={it.id}
                      value={`${it.group} ${it.label}`}
                      onSelect={() => {
                        it.perform();
                        setOpen(false);
                      }}
                      className={cn(
                        "flex h-9 cursor-default items-center gap-2 rounded-sm px-2",
                        "text-body text-text-primary",
                        "data-[selected=true]:bg-surface-3 data-[selected=true]:text-text-primary",
                        "transition-colors duration-fast",
                      )}
                    >
                      <it.icon size={14} className="text-text-tertiary" />
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.shortcut && (
                        <span className="font-mono text-mono-xs text-text-tertiary">
                          {it.shortcut}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
            <div className="flex items-center justify-between border-t border-border-default px-3 py-2 text-overline uppercase text-text-tertiary">
              <span className="flex items-center gap-2">
                <Mail size={10} /> NEXUS Command Palette
              </span>
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <Kbd size="xs">↑↓</Kbd> navigate
                </span>
                <span className="flex items-center gap-1">
                  <Kbd size="xs">↵</Kbd> select
                </span>
              </span>
            </div>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

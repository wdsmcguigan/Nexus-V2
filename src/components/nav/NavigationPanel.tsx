import * as React from "react";
import {
  Inbox,
  Star,
  FileText,
  Send,
  AlarmClock,
  Archive,
  ShieldAlert,
  Trash2,
  Folder,
  Plus,
  ChevronRight,
  ChevronDown,
  Mail,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useWorkspace } from "@/state/workspace";
import { folders, customFolders, accounts } from "@/data/fixtures";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/lib/useMediaQuery";

const ICON_MAP: Record<string, LucideIcon> = {
  Inbox,
  Star,
  FileText,
  Send,
  AlarmClock,
  Archive,
  ShieldAlert,
  Trash2,
  Folder,
  Mail,
};

const PANEL_ID = "nav";

function FolderRow({
  id,
  name,
  iconName,
  count,
  unreadCount,
  active,
  onClick,
}: {
  id: string;
  name: string;
  iconName: string;
  count: number;
  unreadCount: number;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = ICON_MAP[iconName] ?? Folder;
  return (
    <button
      type="button"
      onClick={onClick}
      data-folder-id={id}
      className={cn(
        "group/folder relative flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left",
        "transition-colors duration-fast ease-out",
        "focus-visible:outline-none focus-visible:shadow-focus",
        active
          ? "bg-accent-soft text-text-primary"
          : "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
      )}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-xs bg-accent"
        />
      )}
      <Icon size={14} className={cn(active ? "text-accent" : "opacity-dim group-hover/folder:opacity-full")} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-body",
          unreadCount > 0 && !active && "font-semibold text-text-primary",
        )}
      >
        {name}
      </span>
      {unreadCount > 0 ? (
        <span className="rounded-xs bg-surface-3 px-1 py-px font-mono text-mono-xs font-semibold text-text-secondary">
          {unreadCount}
        </span>
      ) : (
        <span className="font-mono text-mono-xs text-text-tertiary opacity-dim">
          {count}
        </span>
      )}
    </button>
  );
}

export function NavigationPanel() {
  const folderId = useWorkspace((s) => s.selectedFolderId);
  const setFolder = useWorkspace((s) => s.setSelectedFolder);
  const setMobileView = useWorkspace((s) => s.setMobileView);
  const [foldersExpanded, setFoldersExpanded] = React.useState(true);
  const isMobile = useIsMobile();

  function handleFolderClick(id: string) {
    setFolder(id);
    if (isMobile) setMobileView("list");
  }

  return (
    <Panel
      panelId={PANEL_ID}
      type="navigation"
      header={
        isMobile ? undefined : (
          <PanelHeader
            title="Mail"
            hideHandle
            actions={
              <>
                <Tooltip label="Settings" shortcut="⌘,">
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label="Settings"
                  >
                    <SettingsIcon />
                  </Button>
                </Tooltip>
              </>
            }
          />
        )
      }
    >
      <div data-scroll className="nx-scroll h-full overflow-auto">
        {/* Account picker */}
        <div className="border-b border-border-subtle px-2 py-2">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left",
                "transition-colors duration-fast hover:bg-surface-2",
              )}
            >
              <div className="size-2 shrink-0 rounded-full bg-success" />
              <span className="min-w-0 flex-1 truncate font-mono text-mono-sm text-text-secondary">
                {a.email}
              </span>
              {a.unread > 0 && (
                <span className="font-mono text-mono-xs text-text-tertiary">
                  {a.unread}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* System folders */}
        <div className="border-b border-border-subtle p-1">
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              id={f.id}
              name={f.name}
              iconName={f.icon}
              count={f.count}
              unreadCount={f.unreadCount}
              active={folderId === f.id}
              onClick={() => handleFolderClick(f.id)}
            />
          ))}
        </div>

        {/* Custom folders */}
        <div className="p-1">
          <div className="flex items-center px-2 py-1">
            <button
              className="flex flex-1 items-center gap-1 text-overline uppercase text-text-tertiary hover:text-text-secondary"
              onClick={() => setFoldersExpanded((v) => !v)}
            >
              {foldersExpanded ? (
                <ChevronDown size={10} />
              ) : (
                <ChevronRight size={10} />
              )}
              Folders
            </button>
            <Tooltip label="New folder">
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                aria-label="New folder"
              >
                <Plus />
              </Button>
            </Tooltip>
          </div>
          {foldersExpanded &&
            customFolders.map((f) => (
              <FolderRow
                key={f.id}
                id={f.id}
                name={f.name}
                iconName={f.icon}
                count={f.count}
                unreadCount={f.unreadCount}
                active={folderId === f.id}
                onClick={() => handleFolderClick(f.id)}
              />
            ))}
        </div>
      </div>
    </Panel>
  );
}

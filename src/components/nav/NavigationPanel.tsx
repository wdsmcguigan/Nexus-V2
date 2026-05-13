import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
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
  Settings as SettingsIcon,
  Pencil,
  Trash,
  type LucideIcon,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useWorkspace } from "@/state/workspace";
import {
  useSystemLabels,
  useUserLabels,
  useRootFolders,
  useAccounts,
  useLabelUnreadCount,
  useLabelCount,
  useFolderCount,
} from "@/storage/useStore";
import { localStore } from "@/storage/local";
import { cn } from "@/lib/utils";
import type { Folder as FolderType, Label as LabelType } from "@/data/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const PANEL_ID = "nav";

const SYSTEM_LABEL_ICON: Record<string, LucideIcon> = {
  inbox: Inbox,
  starred: Star,
  drafts: FileText,
  sent: Send,
  snoozed: AlarmClock,
  archive: Archive,
  important: ShieldAlert,
  trash: Trash2,
};

const SYNC_DOT_COLOR: Record<string, string> = {
  idle: "bg-success",
  syncing: "bg-info",
  pending: "bg-warning",
  error: "bg-danger",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function labelDotStyle(color: number): React.CSSProperties {
  return { backgroundColor: `var(--color-link-${color})` };
}

// ─── Context menu ─────────────────────────────────────────────────────────────

interface CtxItem {
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  onSelect: () => void;
}

function ContextMenu({
  children,
  items,
}: {
  children: React.ReactNode;
  items: CtxItem[];
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            "z-50 min-w-[160px] overflow-hidden rounded-md border border-border-subtle",
            "bg-surface-2 p-1 shadow-lg",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
          sideOffset={4}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <DropdownMenu.Item
                key={item.label}
                onSelect={item.onSelect}
                className={cn(
                  "flex h-7 cursor-pointer select-none items-center gap-2 rounded-xs px-2 text-body outline-none",
                  "transition-colors duration-fast",
                  item.destructive
                    ? "text-danger focus:bg-danger/10"
                    : "text-text-secondary focus:bg-surface-3 focus:text-text-primary",
                )}
              >
                <Icon size={12} />
                {item.label}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ─── Inline rename input ──────────────────────────────────────────────────────

function InlineRename({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initial);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const trimmed = value.trim();
          if (trimmed) onCommit(trimmed);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        const trimmed = value.trim();
        if (trimmed && trimmed !== initial) onCommit(trimmed);
        else onCancel();
      }}
      className={cn(
        "h-7 w-full rounded-xs border border-accent bg-surface-1 px-2 text-body",
        "text-text-primary outline-none",
      )}
    />
  );
}

// ─── Inline create folder input ───────────────────────────────────────────────

function InlineCreate({
  onCommit,
  onCancel,
}: {
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState("");
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="flex items-center gap-1 px-1">
      <Folder size={12} className="shrink-0 text-text-tertiary" />
      <input
        ref={ref}
        placeholder="Folder name…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const trimmed = value.trim();
            if (trimmed) onCommit(trimmed);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onCancel()}
        className={cn(
          "h-7 flex-1 rounded-xs border border-accent bg-surface-1 px-2 text-body",
          "text-text-primary outline-none placeholder:text-text-tertiary",
        )}
      />
    </div>
  );
}

// ─── System label row ─────────────────────────────────────────────────────────

function SystemLabelRow({ label }: { label: LabelType }) {
  const folderId = useWorkspace((s) => s.selectedFolderId);
  const setFolder = useWorkspace((s) => s.setSelectedFolder);
  const unread = useLabelUnreadCount(label.id);
  const count = useLabelCount(label.id);
  const active = folderId === label.id;
  const Icon = (label.systemKind && SYSTEM_LABEL_ICON[label.systemKind]) || Inbox;

  return (
    <button
      type="button"
      onClick={() => setFolder(label.id)}
      data-label-id={label.id}
      className={cn(
        "group/row relative flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left",
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
      <Icon
        size={14}
        className={cn(active ? "text-accent" : "opacity-dim group-hover/row:opacity-full")}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-body",
          unread > 0 && !active && "font-semibold text-text-primary",
        )}
      >
        {label.name}
      </span>
      {unread > 0 ? (
        <span className="rounded-xs bg-surface-3 px-1 py-px font-mono text-mono-xs font-semibold text-text-secondary">
          {unread}
        </span>
      ) : count > 0 ? (
        <span className="font-mono text-mono-xs text-text-tertiary opacity-dim">
          {count}
        </span>
      ) : null}
    </button>
  );
}

// ─── User label row ───────────────────────────────────────────────────────────

function UserLabelRow({ label }: { label: LabelType }) {
  const folderId = useWorkspace((s) => s.selectedFolderId);
  const setFolder = useWorkspace((s) => s.setSelectedFolder);
  const renameLabel = useWorkspace((s) => s.renameLabel);
  const deleteLabel = useWorkspace((s) => s.deleteLabel);
  const unread = useLabelUnreadCount(label.id);
  const count = useLabelCount(label.id);
  const active = folderId === label.id;
  const [renaming, setRenaming] = React.useState(false);

  const ctxItems: CtxItem[] = [
    {
      label: "Rename",
      icon: Pencil,
      onSelect: () => setRenaming(true),
    },
    {
      label: "Delete",
      icon: Trash,
      destructive: true,
      onSelect: () => deleteLabel(label.id),
    },
  ];

  if (renaming) {
    return (
      <InlineRename
        initial={label.name}
        onCommit={(name) => {
          renameLabel(label.id, name);
          setRenaming(false);
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  return (
    <ContextMenu items={ctxItems}>
      <button
        type="button"
        onClick={() => setFolder(label.id)}
        data-label-id={label.id}
        className={cn(
          "group/row relative flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left",
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
        <span
          className="size-2 shrink-0 rounded-full"
          style={labelDotStyle(label.color)}
          aria-hidden
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-body",
            unread > 0 && !active && "font-semibold text-text-primary",
          )}
        >
          {label.name}
        </span>
        {unread > 0 ? (
          <span className="rounded-xs bg-surface-3 px-1 py-px font-mono text-mono-xs font-semibold text-text-secondary">
            {unread}
          </span>
        ) : count > 0 ? (
          <span className="font-mono text-mono-xs text-text-tertiary opacity-dim">
            {count}
          </span>
        ) : null}
      </button>
    </ContextMenu>
  );
}

// ─── Folder tree row ──────────────────────────────────────────────────────────

function FolderTreeNode({
  folder,
  depth,
  allFolders,
}: {
  folder: FolderType;
  depth: number;
  allFolders: FolderType[];
}) {
  const folderId = useWorkspace((s) => s.selectedFolderId);
  const setFolder = useWorkspace((s) => s.setSelectedFolder);
  const renameFolder = useWorkspace((s) => s.renameFolder);
  const deleteFolder = useWorkspace((s) => s.deleteFolder);
  const count = useFolderCount(folder.id);
  const active = folderId === folder.id;

  const children = allFolders.filter((f) => f.parentId === folder.id);
  const hasChildren = children.length > 0;
  const [expanded, setExpanded] = React.useState(true);
  const [renaming, setRenaming] = React.useState(false);

  const ctxItems: CtxItem[] = [
    {
      label: "Rename",
      icon: Pencil,
      onSelect: () => setRenaming(true),
    },
    {
      label: "Delete",
      icon: Trash,
      destructive: true,
      onSelect: () => deleteFolder(folder.id),
    },
  ];

  const indentPx = depth * 12;

  return (
    <>
      {renaming ? (
        <div style={{ paddingLeft: indentPx + 8 }}>
          <InlineRename
            initial={folder.name}
            onCommit={(name) => {
              const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
              renameFolder(folder.id, name, slug);
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : (
        <ContextMenu items={ctxItems}>
          <button
            type="button"
            onClick={() => setFolder(folder.id)}
            data-folder-id={folder.id}
            style={{ paddingLeft: indentPx + 8 }}
            className={cn(
              "group/row relative flex h-8 w-full items-center gap-2 rounded-sm pr-2 text-left",
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
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((v) => !v);
                }}
                className="flex size-4 shrink-0 items-center justify-center text-text-tertiary hover:text-text-secondary"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <Folder
              size={13}
              className={cn(active ? "text-accent" : "opacity-dim group-hover/row:opacity-full")}
            />
            <span className="min-w-0 flex-1 truncate text-body">{folder.name}</span>
            {count > 0 && (
              <span className="font-mono text-mono-xs text-text-tertiary opacity-dim">
                {count}
              </span>
            )}
          </button>
        </ContextMenu>
      )}
      {hasChildren && expanded &&
        children.map((child) => (
          <FolderTreeNode
            key={child.id}
            folder={child}
            depth={depth + 1}
            allFolders={allFolders}
          />
        ))}
    </>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function NavigationPanel() {
  const systemLabels = useSystemLabels();
  const userLabels = useUserLabels();
  const rootFolders = useRootFolders();
  const accounts = useAccounts();
  const createFolder = useWorkspace((s) => s.createFolder);

  const [foldersExpanded, setFoldersExpanded] = React.useState(true);
  const [labelsExpanded, setLabelsExpanded] = React.useState(true);
  const [creatingFolder, setCreatingFolder] = React.useState(false);

  // Flat list of all folders for child lookups inside FolderTreeNode
  const allFolders = React.useMemo(
    () => Array.from(localStore.folders.values()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localStore.version],
  );

  function handleCreateFolder(name: string) {
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    createFolder({
      id: `fld-${slug}-${Date.now()}`,
      vaultId: "local",
      parentId: null,
      name,
      diskSlug: slug,
      diskPath: slug,
    });
    setCreatingFolder(false);
  }

  return (
    <Panel
      panelId={PANEL_ID}
      type="navigation"
      header={
        <PanelHeader
          title="Mail"
          hideHandle
          actions={
            <Tooltip label="Settings" shortcut="⌘,">
              <Button variant="ghost" size="sm" iconOnly aria-label="Settings">
                <SettingsIcon />
              </Button>
            </Tooltip>
          }
        />
      }
    >
      <div data-scroll className="nx-scroll h-full overflow-auto">
        {/* NAV-ACCOUNT-DOT */}
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
              <div
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  SYNC_DOT_COLOR[a.syncStatus] ?? "bg-success",
                )}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-mono-sm text-text-secondary">
                {a.email}
              </span>
            </button>
          ))}
        </div>

        {/* NAV-SYSTEM-LABEL-LIST */}
        <div className="border-b border-border-subtle p-1">
          {systemLabels.map((label) => (
            <SystemLabelRow key={label.id} label={label} />
          ))}
        </div>

        {/* NAV-FOLDER-TREE */}
        <div className="border-b border-border-subtle p-1">
          <div className="flex items-center px-2 py-1">
            <button
              type="button"
              className="flex flex-1 items-center gap-1 text-overline uppercase text-text-tertiary hover:text-text-secondary"
              onClick={() => setFoldersExpanded((v) => !v)}
            >
              {foldersExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Folders
            </button>
            <Tooltip label="New folder">
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                aria-label="New folder"
                onClick={() => {
                  setFoldersExpanded(true);
                  setCreatingFolder(true);
                }}
              >
                <Plus />
              </Button>
            </Tooltip>
          </div>
          {foldersExpanded && (
            <>
              {rootFolders.map((folder) => (
                <FolderTreeNode
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  allFolders={allFolders}
                />
              ))}
              {/* NAV-FOLDER-CREATE */}
              {creatingFolder && (
                <InlineCreate
                  onCommit={handleCreateFolder}
                  onCancel={() => setCreatingFolder(false)}
                />
              )}
            </>
          )}
        </div>

        {/* NAV-LABEL-LIST */}
        <div className="p-1">
          <div className="flex items-center px-2 py-1">
            <button
              type="button"
              className="flex flex-1 items-center gap-1 text-overline uppercase text-text-tertiary hover:text-text-secondary"
              onClick={() => setLabelsExpanded((v) => !v)}
            >
              {labelsExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Labels
            </button>
          </div>
          {labelsExpanded &&
            userLabels.map((label) => (
              <UserLabelRow key={label.id} label={label} />
            ))}
        </div>
      </div>
    </Panel>
  );
}

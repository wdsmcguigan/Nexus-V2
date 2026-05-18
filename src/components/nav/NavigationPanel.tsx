import * as React from "react";
import * as ReactDOM from "react-dom";
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
  Pencil,
  Trash,
  Palette,
  Bookmark,
  type LucideIcon,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { useWorkspace } from "@/state/workspace";
import {
  useSystemLabels,
  useUserLabels,
  useRootFolders,
  useAccounts,
  useLabelUnreadCount,
  useLabelCount,
  useFolderCount,
  useFolderUnreadCount,
  useSavedViews,
} from "@/storage/useStore";
import { localStore } from "@/storage/local";
import * as Mut from "@/state/mutations";
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
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);

  React.useEffect(() => {
    if (!menu) return;
    function close(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      setMenu(null);
    }
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", close, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", close, true);
    };
  }, [menu]);

  // Clone child to inject onContextMenu without adding a wrapper element
  const child = React.Children.only(children) as React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  const trigger = React.cloneElement(child, {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    },
  });

  return (
    <>
      {trigger}
      {menu &&
        ReactDOM.createPortal(
          <div
            style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 9999 }}
            onMouseDown={(e) => e.stopPropagation()}
            className={cn(
              "min-w-[160px] overflow-hidden rounded-md border border-border-subtle",
              "bg-surface-2 p-1 shadow-lg",
              "animate-in fade-in-0 zoom-in-95",
            )}
          >
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => { item.onSelect(); setMenu(null); }}
                  className={cn(
                    "flex h-7 w-full cursor-pointer select-none items-center gap-2 rounded-xs px-2 text-body outline-none",
                    "transition-colors duration-fast",
                    item.destructive
                      ? "text-danger hover:bg-danger/10"
                      : "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
                  )}
                >
                  <Icon size={12} />
                  {item.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
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

// ─── Inline recolor ───────────────────────────────────────────────────────────

function InlineRecolor({
  current,
  onCommit,
  onCancel,
}: {
  current: number;
  onCommit: (color: number) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xs border border-accent bg-surface-1 px-2 py-1">
      <ColorPicker value={current} onChange={(c) => { onCommit(c); }} />
      <button
        type="button"
        onClick={onCancel}
        className="ml-auto text-text-muted hover:text-text-primary"
      >
        ✕
      </button>
    </div>
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
  const recolorLabel = useWorkspace((s) => s.recolorLabel);
  const deleteLabel = useWorkspace((s) => s.deleteLabel);
  const unread = useLabelUnreadCount(label.id);
  const count = useLabelCount(label.id);
  const active = folderId === label.id;
  const [renaming, setRenaming] = React.useState(false);
  const [recoloring, setRecoloring] = React.useState(false);

  const ctxItems: CtxItem[] = [
    {
      label: "Rename",
      icon: Pencil,
      onSelect: () => setRenaming(true),
    },
    {
      label: "Recolor",
      icon: Palette,
      onSelect: () => setRecoloring(true),
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

  if (recoloring) {
    return (
      <InlineRecolor
        current={label.color}
        onCommit={(color) => {
          recolorLabel(label.id, color);
          setRecoloring(false);
        }}
        onCancel={() => setRecoloring(false)}
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
  const recolorFolder = useWorkspace((s) => s.recolorFolder);
  const deleteFolder = useWorkspace((s) => s.deleteFolder);
  const count = useFolderCount(folder.id);
  const unread = useFolderUnreadCount(folder.id);
  const active = folderId === folder.id;

  const children = allFolders.filter((f) => f.parentId === folder.id);
  const hasChildren = children.length > 0;
  const [expanded, setExpanded] = React.useState(true);
  const [renaming, setRenaming] = React.useState(false);
  const [recoloring, setRecoloring] = React.useState(false);

  const ctxItems: CtxItem[] = [
    {
      label: "Rename",
      icon: Pencil,
      onSelect: () => setRenaming(true),
    },
    {
      label: "Recolor",
      icon: Palette,
      onSelect: () => setRecoloring(true),
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
      ) : recoloring ? (
        <div style={{ paddingLeft: indentPx + 8 }}>
          <InlineRecolor
            current={folder.color ?? 1}
            onCommit={(color) => {
              recolorFolder(folder.id, color);
              setRecoloring(false);
            }}
            onCancel={() => setRecoloring(false)}
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
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-body",
                unread > 0 && !active && "font-semibold text-text-primary",
              )}
            >
              {folder.name}
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
  const savedViews = useSavedViews();
  const createFolder = useWorkspace((s) => s.createFolder);
  const loadSavedView = useWorkspace((s) => s.loadSavedView);
  const deleteSavedView = useWorkspace((s) => s.deleteSavedView);
  const renameSavedView = useWorkspace((s) => s.renameSavedView);
  const selectedSavedViewId = useWorkspace((s) => s.selectedSavedViewId);

  const [foldersExpanded, setFoldersExpanded] = React.useState(true);
  const [labelsExpanded, setLabelsExpanded] = React.useState(true);
  const [viewsExpanded, setViewsExpanded] = React.useState(true);
  const [creatingFolder, setCreatingFolder] = React.useState(false);
  const [creatingLabel, setCreatingLabel] = React.useState(false);
  const [renamingViewId, setRenamingViewId] = React.useState<string | null>(null);
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
      header={<PanelHeader title="Mail" hideHandle />}
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

        {/* VW-SAVED — Saved views section */}
        {savedViews.length > 0 && (
          <div className="border-b border-border-subtle p-1">
            <button
              type="button"
              className="flex w-full items-center gap-1 px-2 py-1 text-overline uppercase text-text-tertiary hover:text-text-secondary"
              onClick={() => setViewsExpanded((v) => !v)}
            >
              {viewsExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              Saved views
            </button>
            {viewsExpanded && savedViews.map((view) => {
              const isSelected = selectedSavedViewId === view.id;
              if (renamingViewId === view.id) {
                return (
                  <InlineRename
                    key={view.id}
                    initial={view.name}
                    onCommit={(name) => { renameSavedView(view.id, name); setRenamingViewId(null); }}
                    onCancel={() => setRenamingViewId(null)}
                  />
                );
              }
              return (
                <ContextMenu
                  key={view.id}
                  items={[
                    { label: "Rename", icon: Pencil, onSelect: () => setRenamingViewId(view.id) },
                    { label: "Delete", icon: Trash, destructive: true, onSelect: () => deleteSavedView(view.id) },
                  ]}
                >
                  <button
                    type="button"
                    onClick={() => loadSavedView(view.id)}
                    className={cn(
                      "flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-body",
                      "transition-colors duration-fast hover:bg-surface-2",
                      isSelected
                        ? "bg-accent-soft font-medium text-text-primary"
                        : "text-text-secondary",
                    )}
                  >
                    <Bookmark size={12} className="shrink-0 text-text-tertiary" />
                    <span className="min-w-0 flex-1 truncate">{view.name}</span>
                  </button>
                </ContextMenu>
              );
            })}
          </div>
        )}

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
            <Tooltip label="New label">
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                aria-label="New label"
                onClick={() => {
                  setLabelsExpanded(true);
                  setCreatingLabel(true);
                }}
              >
                <Plus />
              </Button>
            </Tooltip>
          </div>
          {labelsExpanded && (
            <>
              {userLabels.map((label) => (
                <UserLabelRow key={label.id} label={label} />
              ))}
              {creatingLabel && (
                <InlineCreate
                  onCommit={(name) => {
                    Mut.createLabel(localStore, {
                      id: `lbl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      vaultId: localStore.vault?.id ?? "local",
                      kind: "user",
                      name,
                      color: Math.floor(Math.random() * 12),
                      position: localStore.labels.size,
                    });
                    setCreatingLabel(false);
                  }}
                  onCancel={() => setCreatingLabel(false)}
                />
              )}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

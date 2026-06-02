import * as React from "react";
import * as ReactDOM from "react-dom";
import * as RCMenu from "@radix-ui/react-context-menu";
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
  Check,
  type LucideIcon,
} from "lucide-react";
import { Panel } from "@/components/panel/Panel";
import { PanelHeader } from "@/components/panel/PanelHeader";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import { Tooltip } from "@/components/ui/Tooltip";
import { ColorPicker } from "@/components/ui/ColorPicker";
import { useWorkspace } from "@/state/workspace";
import {
  useSystemLabels,
  useRootUserLabels,
  useLabelChildren,
  useRootFolders,
  useAccounts,
  useLabelUnreadCount,
  useLabelCount,
  useFolderCount,
  useFolderUnreadCount,
  useSavedViews,
  useAllTags,
} from "@/storage/useStore";
import { localStore } from "@/storage/local";
import * as Mut from "@/state/mutations";
import { cn } from "@/lib/utils";
import type { PanelLink } from "@/design-system/tokens";
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
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menu) return;
    function close(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      // Don't close when the click is inside the menu itself — let onClick fire first
      if (e instanceof MouseEvent && menuRef.current?.contains(e.target as Node)) return;
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
            ref={menuRef}
            style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 9999 }}
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
  const [dragOver, setDragOver] = React.useState(false);

  return (
    <button
      type="button"
      onClick={() => setFolder(label.id)}
      data-label-id={label.id}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const msgId = e.dataTransfer.getData("message-id");
        if (msgId) Mut.addLabel(localStore, msgId, label.id);
      }}
      className={cn(
        "group/row relative flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left",
        "transition-colors duration-fast ease-out",
        "focus-visible:outline-none focus-visible:shadow-focus",
        dragOver && "bg-accent/20 ring-1 ring-accent",
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
      <span className="min-w-0 flex-1 truncate text-body">{label.name}</span>
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

// ─── Label tree row ───────────────────────────────────────────────────────────
// Mirrors FolderTreeNode: supports arbitrary nesting depth, expand/collapse,
// inline rename/recolor, and context menu. Display name is the last path segment
// (e.g. "Social Media/TikTok" → "TikTok") since parents are rendered above it.

function LabelTreeNode({ label, depth = 0 }: { label: LabelType; depth?: number }) {
  const children = useLabelChildren(label.id);
  const hasChildren = children.length > 0;
  const [expanded, setExpanded] = React.useState(false);

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
  const [creatingChild, setCreatingChild] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);

  // Show only the last segment so nested labels don't repeat the full path.
  const displayName = label.name.includes("/")
    ? (label.name.split("/").at(-1) ?? label.name)
    : label.name;

  const indentPx = depth * 12;

  const ctxItems: CtxItem[] = [
    { label: "Rename",        icon: Pencil,  onSelect: () => setRenaming(true) },
    { label: "Recolor",       icon: Palette, onSelect: () => setRecoloring(true) },
    { label: "New sub-label", icon: Plus,    onSelect: () => { setExpanded(true); setCreatingChild(true); } },
    { label: "Delete",        icon: Trash,   destructive: true, onSelect: () => deleteLabel(label.id) },
  ];

  return (
    <>
      {renaming ? (
        <div style={{ paddingLeft: indentPx + 8 }}>
          <InlineRename
            initial={displayName}
            onCommit={(name) => { renameLabel(label.id, name); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : recoloring ? (
        <div style={{ paddingLeft: indentPx + 8 }}>
          <InlineRecolor
            current={label.color}
            onCommit={(color) => { recolorLabel(label.id, color); setRecoloring(false); }}
            onCancel={() => setRecoloring(false)}
          />
        </div>
      ) : (
        <ContextMenu items={ctxItems}>
          <button
            type="button"
            onClick={() => setFolder(label.id)}
            data-label-id={label.id}
            style={{ paddingLeft: indentPx + 8 }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const msgId = e.dataTransfer.getData("message-id");
              if (msgId) Mut.addLabel(localStore, msgId, label.id);
            }}
            className={cn(
              "group/row relative flex h-8 w-full items-center gap-2 rounded-sm pr-2 text-left",
              "transition-colors duration-fast ease-out",
              "focus-visible:outline-none focus-visible:shadow-focus",
              dragOver && "bg-accent/20 ring-1 ring-accent",
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
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="flex size-4 shrink-0 items-center justify-center text-text-tertiary hover:text-text-secondary"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </button>
            ) : (
              <span className="size-4 shrink-0" />
            )}
            <Tag
              color={label.color as PanelLink}
              size="sm"
              selected={active}
            >
              {displayName}
            </Tag>
            <span className="flex-1" />
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
      {expanded && (
        <>
          {children.map((child) => (
            <LabelTreeNode key={child.id} label={child} depth={depth + 1} />
          ))}
          {creatingChild && (
            <div style={{ paddingLeft: indentPx + 20 }}>
              <InlineCreate
                onCommit={(name) => {
                  Mut.createLabel(localStore, {
                    id: `lbl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    vaultId: localStore.vault?.id ?? "local",
                    kind: "user",
                    name,
                    color: label.color,
                    parentId: label.id,
                    position: children.length,
                  });
                  setCreatingChild(false);
                }}
                onCancel={() => setCreatingChild(false)}
              />
            </div>
          )}
        </>
      )}
    </>
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
  const [dragOver, setDragOver] = React.useState(false);

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
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const msgId = e.dataTransfer.getData("message-id");
              if (msgId) Mut.moveToFolder(localStore, msgId, folder.id);
            }}
            className={cn(
              "group/row relative flex h-8 w-full items-center gap-2 rounded-sm pr-2 text-left",
              "transition-colors duration-fast ease-out",
              "focus-visible:outline-none focus-visible:shadow-focus",
              dragOver && "bg-accent/20 ring-1 ring-accent",
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

// ─── Tag nav row ──────────────────────────────────────────────────────────────

function TagNavRow({ tag }: { tag: string }) {
  const folderId = useWorkspace((s) => s.selectedFolderId);
  const setFolder = useWorkspace((s) => s.setSelectedFolder);
  const tagId = `tag:${tag}`;
  const active = folderId === tagId;
  const count = localStore.messagesByTag.get(tag)?.size ?? 0;

  return (
    <button
      type="button"
      onClick={() => setFolder(tagId)}
      className={cn(
        "group/row relative flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left",
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
      <span className="shrink-0 font-mono text-mono-xs text-text-tertiary">#</span>
      <span className="flex-1 truncate text-body">{tag}</span>
      {count > 0 && (
        <span className="font-mono text-mono-xs text-text-tertiary opacity-dim">{count}</span>
      )}
    </button>
  );
}

// ─── Labels & Tags context menu ───────────────────────────────────────────────

type LabelSort = "manual" | "alpha-asc" | "alpha-desc" | "count-desc" | "recently-created" | "recently-used";
type TagSort   = "count-desc" | "alpha-asc" | "alpha-desc" | "recently-used";

const LABEL_SORT_LABELS: Record<LabelSort, string> = {
  "manual":           "Manual order",
  "alpha-asc":        "A → Z",
  "alpha-desc":       "Z → A",
  "count-desc":       "Most used",
  "recently-created": "Recently created",
  "recently-used":    "Recently used",
};
const TAG_SORT_LABELS: Record<TagSort, string> = {
  "count-desc":    "Most used",
  "alpha-asc":     "A → Z",
  "alpha-desc":    "Z → A",
  "recently-used": "Recently used",
};

const cmContent = cn(
  "z-50 min-w-[200px] overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-1 shadow-l3",
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
);
const cmItem = cn(
  "relative flex h-7 cursor-default select-none items-center gap-2 rounded-xs px-2 pl-6 text-body outline-none",
  "text-text-secondary data-[highlighted]:bg-surface-3 data-[highlighted]:text-text-primary",
  "transition-colors duration-fast",
);
const cmLabel = "px-2 py-1 text-overline uppercase text-text-muted";
const cmSeparator = "my-1 h-px bg-border-subtle";
const cmSubTrigger = cn(cmItem, "data-[state=open]:bg-surface-3 data-[state=open]:text-text-primary");

// ─── Main panel ───────────────────────────────────────────────────────────────

export function NavigationPanel() {
  const systemLabels = useSystemLabels();
  const rootUserLabels = useRootUserLabels();
  const rootFolders = useRootFolders();
  const accounts = useAccounts();
  const savedViews = useSavedViews();
  const createFolder = useWorkspace((s) => s.createFolder);
  const loadSavedView = useWorkspace((s) => s.loadSavedView);
  const deleteSavedView = useWorkspace((s) => s.deleteSavedView);
  const renameSavedView = useWorkspace((s) => s.renameSavedView);
  const selectedSavedViewId = useWorkspace((s) => s.selectedSavedViewId);

  const allTags = useAllTags();

  // Labels & Tags display preferences
  const [showLabels, setShowLabels] = React.useState(true);
  const [showTags, setShowTags] = React.useState(true);
  const [labelSort, setLabelSort] = React.useState<LabelSort>("manual");
  const [tagSort, setTagSort] = React.useState<TagSort>("count-desc");

  const sortedRootLabels = React.useMemo(() => {
    if (!showLabels) return [];
    if (labelSort === "alpha-asc")  return [...rootUserLabels].sort((a, b) => a.name.localeCompare(b.name));
    if (labelSort === "alpha-desc") return [...rootUserLabels].sort((a, b) => b.name.localeCompare(a.name));
    if (labelSort === "count-desc") {
      const counts = new Map<string, number>();
      for (const msg of localStore.messages.values()) {
        for (const lid of msg.labelIds) counts.set(lid, (counts.get(lid) ?? 0) + 1);
      }
      return [...rootUserLabels].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
    }
    if (labelSort === "recently-created") {
      // IDs are generated as `lbl-{Date.now()}-{random}` so the timestamp is in segment [1]
      const tsOf = (id: string) => parseInt(id.split("-")[1] ?? "0", 10) || 0;
      return [...rootUserLabels].sort((a, b) => tsOf(b.id) - tsOf(a.id));
    }
    if (labelSort === "recently-used") {
      const lastUsed = new Map<string, number>();
      for (const msg of localStore.messages.values()) {
        for (const lid of msg.labelIds) {
          if (msg.receivedAt > (lastUsed.get(lid) ?? 0)) lastUsed.set(lid, msg.receivedAt);
        }
      }
      return [...rootUserLabels].sort((a, b) => (lastUsed.get(b.id) ?? 0) - (lastUsed.get(a.id) ?? 0));
    }
    return rootUserLabels;
  }, [rootUserLabels, labelSort, showLabels]);

  const sortedTags = React.useMemo(() => {
    if (!showTags) return [];
    if (tagSort === "alpha-asc")     return [...allTags].sort((a, b) => a.localeCompare(b));
    if (tagSort === "alpha-desc")    return [...allTags].sort((a, b) => b.localeCompare(a));
    if (tagSort === "recently-used") {
      return [...allTags].sort((a, b) =>
        (localStore.tagUsage.get(b)?.lastUsedAt ?? 0) - (localStore.tagUsage.get(a)?.lastUsedAt ?? 0)
      );
    }
    return allTags; // count-desc — already sorted by useAllTags()
  }, [allTags, tagSort, showTags]);

  const [foldersExpanded, setFoldersExpanded] = React.useState(true);
  const [labelTagsExpanded, setLabelTagsExpanded] = React.useState(true);
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
              <div className="relative shrink-0">
                <Avatar name={a.email} size={20} colorSeed={8} src={a.photoUrl} email={a.email} />
                <div
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-1 ring-surface-1",
                    SYNC_DOT_COLOR[a.syncStatus] ?? "bg-success",
                  )}
                />
              </div>
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

        {/* NAV-LABEL-TAG-LIST */}
        <div className="p-1">
          <RCMenu.Root>
            <RCMenu.Trigger asChild>
              <div className="flex items-center px-2 py-1">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-1 text-overline uppercase text-text-tertiary hover:text-text-secondary"
                  onClick={() => setLabelTagsExpanded((v) => !v)}
                >
                  {labelTagsExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  Labels &amp; Tags
                  {(!showLabels || !showTags) && (
                    <span className="ml-1 size-1.5 rounded-full bg-accent" title="Some items hidden" />
                  )}
                </button>
                <Tooltip label="New label">
                  <Button
                    variant="ghost"
                    size="xs"
                    iconOnly
                    aria-label="New label"
                    onClick={() => {
                      setLabelTagsExpanded(true);
                      setCreatingLabel(true);
                    }}
                  >
                    <Plus />
                  </Button>
                </Tooltip>
              </div>
            </RCMenu.Trigger>

            <RCMenu.Portal>
              <RCMenu.Content className={cmContent}>
                {/* Visibility toggles */}
                <div className={cmLabel}>Show</div>
                <RCMenu.CheckboxItem
                  checked={showLabels}
                  onCheckedChange={(v) => setShowLabels(!!v)}
                  className={cmItem}
                >
                  <RCMenu.ItemIndicator className="absolute left-2">
                    <Check size={11} />
                  </RCMenu.ItemIndicator>
                  Labels
                </RCMenu.CheckboxItem>
                <RCMenu.CheckboxItem
                  checked={showTags}
                  onCheckedChange={(v) => setShowTags(!!v)}
                  className={cmItem}
                >
                  <RCMenu.ItemIndicator className="absolute left-2">
                    <Check size={11} />
                  </RCMenu.ItemIndicator>
                  Tags
                </RCMenu.CheckboxItem>

                <div className={cmSeparator} />

                {/* Label sort submenu */}
                <RCMenu.Sub>
                  <RCMenu.SubTrigger className={cmSubTrigger}>
                    <span className="flex-1">Label order</span>
                    <span className="ml-auto flex items-center gap-1.5 text-text-muted">
                      <span className="font-mono text-mono-xs">{LABEL_SORT_LABELS[labelSort]}</span>
                      <ChevronRight size={11} />
                    </span>
                  </RCMenu.SubTrigger>
                  <RCMenu.Portal>
                    <RCMenu.SubContent className={cmContent}>
                      <RCMenu.RadioGroup
                        value={labelSort}
                        onValueChange={(v) => setLabelSort(v as LabelSort)}
                      >
                        {(["manual", "alpha-asc", "alpha-desc", "count-desc", "recently-created", "recently-used"] as LabelSort[]).map((val) => (
                          <RCMenu.RadioItem key={val} value={val} className={cmItem}>
                            <RCMenu.ItemIndicator className="absolute left-2">
                              <Check size={11} />
                            </RCMenu.ItemIndicator>
                            {LABEL_SORT_LABELS[val]}
                          </RCMenu.RadioItem>
                        ))}
                      </RCMenu.RadioGroup>
                    </RCMenu.SubContent>
                  </RCMenu.Portal>
                </RCMenu.Sub>

                {/* Tag sort submenu */}
                <RCMenu.Sub>
                  <RCMenu.SubTrigger className={cmSubTrigger}>
                    <span className="flex-1">Tag order</span>
                    <span className="ml-auto flex items-center gap-1.5 text-text-muted">
                      <span className="font-mono text-mono-xs">{TAG_SORT_LABELS[tagSort]}</span>
                      <ChevronRight size={11} />
                    </span>
                  </RCMenu.SubTrigger>
                  <RCMenu.Portal>
                    <RCMenu.SubContent className={cmContent}>
                      <RCMenu.RadioGroup
                        value={tagSort}
                        onValueChange={(v) => setTagSort(v as TagSort)}
                      >
                        {(["count-desc", "alpha-asc", "alpha-desc", "recently-used"] as TagSort[]).map((val) => (
                          <RCMenu.RadioItem key={val} value={val} className={cmItem}>
                            <RCMenu.ItemIndicator className="absolute left-2">
                              <Check size={11} />
                            </RCMenu.ItemIndicator>
                            {TAG_SORT_LABELS[val]}
                          </RCMenu.RadioItem>
                        ))}
                      </RCMenu.RadioGroup>
                    </RCMenu.SubContent>
                  </RCMenu.Portal>
                </RCMenu.Sub>
              </RCMenu.Content>
            </RCMenu.Portal>
          </RCMenu.Root>

          {labelTagsExpanded && (
            <>
              {showLabels && sortedRootLabels.map((label) => (
                <LabelTreeNode key={label.id} label={label} depth={0} />
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
              {showTags && sortedTags.length > 0 && (
                <div className={cn(showLabels && sortedRootLabels.length > 0 && "border-t border-border-subtle mt-1 pt-1")}>
                  {sortedTags.map((tag) => (
                    <TagNavRow key={tag} tag={tag} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}

import * as React from "react";
import { Plus, Pencil, Trash2, Users, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ContactGroup } from "@/data/types";

interface Props {
  groups: ContactGroup[];
  selectedGroupId: string | null;
  onSelectGroup: (id: string | null) => void;
  onCreateGroup: (name: string) => void;
  onRenameGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
}

export function ContactGroupsSidebar({
  groups,
  selectedGroupId,
  onSelectGroup,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
}: Props) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");

  const startEdit = (g: ContactGroup) => {
    setEditingId(g.id);
    setEditName(g.name);
  };

  const commitEdit = () => {
    if (editingId && editName.trim()) {
      onRenameGroup(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const commitCreate = () => {
    if (newName.trim()) {
      onCreateGroup(newName.trim());
    }
    setCreating(false);
    setNewName("");
  };

  return (
    <div className="flex h-full flex-col border-r border-border-subtle bg-surface-1" style={{ width: 140, minWidth: 120 }}>
      <div className="px-3 py-2.5 text-overline uppercase tracking-wider text-text-tertiary">
        Groups
      </div>

      <nav className="flex-1 overflow-y-auto px-1.5 pb-2">
        {/* All Contacts */}
        <GroupRow
          label="All Contacts"
          icon={<Users size={12} />}
          selected={selectedGroupId === null}
          onClick={() => onSelectGroup(null)}
        />
        {/* VIPs */}
        <GroupRow
          label="VIPs"
          icon={<Star size={12} />}
          selected={selectedGroupId === "__vip"}
          onClick={() => onSelectGroup("__vip")}
        />

        {groups.length > 0 && (
          <div className="my-1.5 h-px bg-border-subtle" />
        )}

        {groups.map((g) => (
          <div key={g.id} className="group/row relative">
            {editingId === g.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                className="w-full rounded-sm bg-surface-3 px-2 py-1 text-small text-text-primary outline-none ring-1 ring-accent"
              />
            ) : (
              <>
                <GroupRow
                  label={g.name}
                  color={g.color}
                  selected={selectedGroupId === g.id}
                  onClick={() => onSelectGroup(g.id)}
                />
                <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover/row:flex">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); startEdit(g); }}
                    className="rounded-xs p-0.5 text-text-tertiary hover:text-text-primary"
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onDeleteGroup(g.id); }}
                    className="rounded-xs p-0.5 text-text-tertiary hover:text-status-error"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}

        {creating && (
          <input
            autoFocus
            value={newName}
            placeholder="Group name…"
            onChange={(e) => setNewName(e.target.value)}
            onBlur={commitCreate}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCreate();
              if (e.key === "Escape") { setCreating(false); setNewName(""); }
            }}
            className="mt-0.5 w-full rounded-sm bg-surface-3 px-2 py-1 text-small text-text-primary outline-none ring-1 ring-accent"
          />
        )}
      </nav>

      <div className="border-t border-border-subtle px-2 py-2">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-small text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
        >
          <Plus size={11} />
          New Group
        </button>
      </div>
    </div>
  );
}

function GroupRow({
  label,
  icon,
  color,
  selected,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  color?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-small transition-colors",
        selected
          ? "bg-accent/15 text-accent"
          : "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
      )}
    >
      {icon ?? (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color ?? "var(--color-text-tertiary)" }}
        />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

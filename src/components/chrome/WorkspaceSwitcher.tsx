import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, Check, Zap, ZapOff, PencilLine, Trash2, Save, CopyPlus, FolderPlus } from "lucide-react";
import { useWorkspace } from "@/state/workspace";
import { cn } from "@/lib/utils";

// ─── WorkspaceSwitcher ────────────────────────────────────────────────────────

export function WorkspaceSwitcher() {
  const workspaces = useWorkspace((s) => s.workspaces);
  const activeWorkspaceId = useWorkspace((s) => s.activeWorkspaceId);
  const switchWorkspace = useWorkspace((s) => s.switchWorkspace);
  const saveWorkspace = useWorkspace((s) => s.saveWorkspace);
  const saveAsWorkspace = useWorkspace((s) => s.saveAsWorkspace);
  const createWorkspace = useWorkspace((s) => s.createWorkspace);
  const renameWorkspace = useWorkspace((s) => s.renameWorkspace);
  const deleteWorkspace = useWorkspace((s) => s.deleteWorkspace);
  const toggleAutoSave = useWorkspace((s) => s.toggleAutoSave);

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);

  const [dialogMode, setDialogMode] = React.useState<"new" | "saveAs" | "rename" | null>(null);
  const [inputName, setInputName] = React.useState("");
  const [newWsMode, setNewWsMode] = React.useState<"fresh" | "clone">("fresh");

  // ⌘S global shortcut
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        saveWorkspace();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveWorkspace]);

  // ⌘1-9 workspace switching
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const n = parseInt(e.key, 10);
      if (isNaN(n) || n < 1 || n > 9) return;
      const ws = workspaces[n - 1];
      if (ws && ws.id !== activeWorkspaceId) {
        e.preventDefault();
        switchWorkspace(ws.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workspaces, activeWorkspaceId, switchWorkspace]);

  function openDialog(mode: "new" | "saveAs" | "rename") {
    setInputName(mode === "rename" ? (activeWs?.name ?? "") : "");
    setNewWsMode("fresh");
    setDialogMode(mode);
  }

  function handleDialogConfirm() {
    const name = inputName.trim();
    if (!name) return;
    if (dialogMode === "new") createWorkspace(name, newWsMode);
    else if (dialogMode === "saveAs") saveAsWorkspace(name);
    else if (dialogMode === "rename") renameWorkspace(activeWorkspaceId, name);
    setDialogMode(null);
    setInputName("");
  }

  const dialogTitle =
    dialogMode === "new" ? "New workspace" :
    dialogMode === "saveAs" ? "Save as…" :
    "Rename workspace";

  const dialogConfirmLabel =
    dialogMode === "new" ? "Create" :
    dialogMode === "saveAs" ? "Save as" :
    "Rename";

  return (
    <>
      {/* ── Dropdown trigger ─────────────────────────────────────────── */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-sm bg-surface-2 px-2.5",
              "text-caption text-text-secondary hover:bg-surface-3",
              "transition-colors duration-fast outline-none",
              "data-[state=open]:bg-surface-3",
            )}
          >
            <span className="max-w-[160px] truncate">{activeWs?.name ?? "Workspace"}</span>
            {activeWs?.autoSave && (
              <Zap size={10} className="shrink-0 text-accent" aria-label="Auto-save on" />
            )}
            <ChevronDown size={11} className="shrink-0 text-text-tertiary" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            sideOffset={5}
            align="start"
            className={cn(
              "z-50 min-w-[220px] rounded-md border border-border-default bg-surface-4 shadow-l3",
              "p-1",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            )}
          >
            {/* Workspace list */}
            <DropdownMenu.Label className="px-2 pb-1 pt-1 text-overline uppercase text-text-tertiary">
              Workspaces
            </DropdownMenu.Label>

            {workspaces.map((ws, i) => (
              <DropdownMenu.Item
                key={ws.id}
                onSelect={() => ws.id !== activeWorkspaceId && switchWorkspace(ws.id)}
                className={cn(
                  "flex h-8 cursor-default items-center gap-2 rounded-xs px-2",
                  "text-body text-text-primary outline-none",
                  "data-[highlighted]:bg-surface-3",
                  ws.id === activeWorkspaceId && "text-text-primary",
                )}
              >
                <Check
                  size={12}
                  className={cn(
                    "shrink-0",
                    ws.id === activeWorkspaceId ? "text-accent" : "opacity-0",
                  )}
                />
                <span className="flex-1 truncate">{ws.name}</span>
                {ws.autoSave && <Zap size={10} className="shrink-0 text-accent opacity-60" />}
                <span className="shrink-0 font-mono text-mono-xs text-text-muted">
                  {i < 9 ? `⌘${i + 1}` : ""}
                </span>
              </DropdownMenu.Item>
            ))}

            <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />

            {/* Active workspace actions */}
            <DropdownMenu.Label className="px-2 pb-1 pt-1 text-overline uppercase text-text-tertiary">
              {activeWs?.name ?? "Current"}
            </DropdownMenu.Label>

            <DropdownMenu.Item
              onSelect={() => toggleAutoSave(activeWorkspaceId)}
              className={cn(
                "flex h-8 cursor-default items-center gap-2 rounded-xs px-2",
                "text-body text-text-primary outline-none",
                "data-[highlighted]:bg-surface-3",
              )}
            >
              {activeWs?.autoSave ? (
                <ZapOff size={13} className="shrink-0 text-text-tertiary" />
              ) : (
                <Zap size={13} className="shrink-0 text-text-tertiary" />
              )}
              <span className="flex-1">
                {activeWs?.autoSave ? "Disable auto-save" : "Enable auto-save"}
              </span>
            </DropdownMenu.Item>

            <DropdownMenu.Item
              onSelect={() => openDialog("rename")}
              className={cn(
                "flex h-8 cursor-default items-center gap-2 rounded-xs px-2",
                "text-body text-text-primary outline-none",
                "data-[highlighted]:bg-surface-3",
              )}
            >
              <PencilLine size={13} className="shrink-0 text-text-tertiary" />
              <span>Rename…</span>
            </DropdownMenu.Item>

            <DropdownMenu.Item
              onSelect={() => deleteWorkspace(activeWorkspaceId)}
              disabled={workspaces.length <= 1}
              className={cn(
                "flex h-8 cursor-default items-center gap-2 rounded-xs px-2",
                "text-body outline-none",
                "data-[highlighted]:bg-surface-3",
                workspaces.length <= 1
                  ? "cursor-not-allowed text-text-muted"
                  : "text-danger hover:text-danger",
              )}
            >
              <Trash2 size={13} className="shrink-0" />
              <span>Delete</span>
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />

            {/* Save actions */}
            <DropdownMenu.Item
              onSelect={saveWorkspace}
              className={cn(
                "flex h-8 cursor-default items-center gap-2 rounded-xs px-2",
                "text-body text-text-primary outline-none",
                "data-[highlighted]:bg-surface-3",
              )}
            >
              <Save size={13} className="shrink-0 text-text-tertiary" />
              <span className="flex-1">Save workspace</span>
              <span className="font-mono text-mono-xs text-text-muted">⌘S</span>
            </DropdownMenu.Item>

            <DropdownMenu.Item
              onSelect={() => openDialog("saveAs")}
              className={cn(
                "flex h-8 cursor-default items-center gap-2 rounded-xs px-2",
                "text-body text-text-primary outline-none",
                "data-[highlighted]:bg-surface-3",
              )}
            >
              <CopyPlus size={13} className="shrink-0 text-text-tertiary" />
              <span>Save as…</span>
            </DropdownMenu.Item>

            <DropdownMenu.Item
              onSelect={() => openDialog("new")}
              className={cn(
                "flex h-8 cursor-default items-center gap-2 rounded-xs px-2",
                "text-body text-text-primary outline-none",
                "data-[highlighted]:bg-surface-3",
              )}
            >
              <FolderPlus size={13} className="shrink-0 text-text-tertiary" />
              <span>New workspace…</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* ── Dialog for new / save-as / rename ────────────────────────── */}
      <Dialog.Root
        open={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open) { setDialogMode(null); setInputName(""); }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-canvas/60 backdrop-blur-sm",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            )}
          />
          <Dialog.Content
            className={cn(
              "fixed left-1/2 top-[30vh] z-50 w-[400px] max-w-[92vw] -translate-x-1/2",
              "rounded-xl border border-border-default bg-surface-4 shadow-l3 p-5",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            )}
          >
            <Dialog.Title className="mb-4 font-sans text-body font-semibold text-text-primary">
              {dialogTitle}
            </Dialog.Title>

            <input
              value={inputName}
              onChange={(e) => setInputName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleDialogConfirm();
                if (e.key === "Escape") { setDialogMode(null); setInputName(""); }
              }}
              placeholder="Workspace name"
              autoFocus
              className={cn(
                "w-full rounded-sm border border-border-default bg-surface-2 px-3 py-2",
                "font-sans text-body text-text-primary placeholder:text-text-muted",
                "focus:border-accent focus:outline-none",
                "transition-colors duration-fast",
              )}
            />

            {/* "Start fresh" vs "Clone" radio — only for new workspace */}
            {dialogMode === "new" && (
              <div className="mt-4 flex flex-col gap-2">
                <p className="text-small text-text-tertiary">Initial layout</p>
                {(["fresh", "clone"] as const).map((mode) => (
                  <label
                    key={mode}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2.5",
                      "transition-colors duration-fast",
                      newWsMode === mode
                        ? "border-accent bg-accent-soft text-text-primary"
                        : "border-border-subtle bg-surface-3 text-text-secondary hover:border-border-default",
                    )}
                  >
                    <input
                      type="radio"
                      name="ws-mode"
                      value={mode}
                      checked={newWsMode === mode}
                      onChange={() => setNewWsMode(mode)}
                      className="accent-accent"
                    />
                    <span className="text-body">
                      {mode === "fresh" ? "Start fresh — default layout" : "Clone current layout"}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setDialogMode(null); setInputName(""); }}
                className={cn(
                  "h-8 rounded-sm px-3 font-sans text-body text-text-secondary",
                  "hover:bg-surface-3 transition-colors duration-fast",
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDialogConfirm}
                disabled={!inputName.trim()}
                className={cn(
                  "h-8 rounded-sm px-4 font-sans text-body font-medium",
                  "bg-accent text-text-on-accent",
                  "hover:opacity-90 transition-opacity duration-fast",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                )}
              >
                {dialogConfirmLabel}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

import * as React from "react";
import {
  Compass,
  Mail,
  MessageSquare,
  Info,
  Users,
  Calendar,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModuleKey, PanelColorPrefs } from "@/data/types";
import {
  DEFAULT_MODULE_COLORS,
} from "@/lib/panelColors";
import {
  getAppPreferences,
  saveAppPreferences,
} from "@/lib/appPreferences";
import { useWorkspace } from "@/state/workspace";
import { SwatchPopover } from "@/components/settings/SwatchPopover";

interface ModuleMeta {
  key: ModuleKey;
  name: string;
  description: string;
  Icon: LucideIcon;
}

const MODULES: ModuleMeta[] = [
  { key: "nav", name: "Navigation", description: "Sidebar with folders, labels, calendars", Icon: Compass },
  { key: "list", name: "Mail", description: "Message list", Icon: Mail },
  { key: "viewer", name: "Message", description: "Reader / thread viewer", Icon: MessageSquare },
  { key: "inspector", name: "Inspector", description: "Per-message metadata sidebar", Icon: Info },
  { key: "contacts", name: "Contacts", description: "Address book", Icon: Users },
  { key: "calendar", name: "Calendar", description: "Agenda, week, month views", Icon: Calendar },
  { key: "settings", name: "Settings", description: "This panel", Icon: SettingsIcon },
];

export function PanelColorsSettings() {
  // Re-render trigger: bump on every save so reads of getAppPreferences are fresh.
  const [, bump] = React.useReducer((x: number) => x + 1, 0);

  const activeWs = useWorkspace((s) =>
    s.workspaces.find((w) => w.id === s.activeWorkspaceId),
  );
  const setActiveWorkspacePanelColors = useWorkspace(
    (s) => s.setActiveWorkspacePanelColors,
  );

  const userPrefs = getAppPreferences().panelColors;
  const wsPrefs = activeWs?.panelColors;
  const editingWorkspace = !!wsPrefs;
  const activePrefs: PanelColorPrefs = wsPrefs ?? userPrefs;

  const writePrefs = (next: PanelColorPrefs) => {
    if (editingWorkspace) {
      setActiveWorkspacePanelColors(next);
    } else {
      saveAppPreferences({ panelColors: next });
    }
    bump();
  };

  const toggleWorkspaceOverride = (checked: boolean) => {
    if (checked) {
      // Seed the workspace override from the current user prefs (so the user
      // sees the same colors they had before opting in).
      setActiveWorkspacePanelColors({ ...userPrefs });
    } else {
      // Drop the workspace override entirely.
      setActiveWorkspacePanelColors(undefined);
    }
    bump();
  };

  const setModuleColor = (module: ModuleKey, color: string) => {
    writePrefs({
      ...activePrefs,
      colors: { ...activePrefs.colors, [module]: color },
    });
  };

  const resetModule = (module: ModuleKey) => {
    const { [module]: _, ...rest } = activePrefs.colors;
    writePrefs({ ...activePrefs, colors: rest });
  };

  const resetAll = () => {
    writePrefs({ ...activePrefs, colors: {} });
  };

  const setBodyTintLevel = (level: "L2" | "L3") => {
    writePrefs({ ...activePrefs, bodyTintLevel: level });
  };

  return (
    <section>
      <h3 className="mb-3 flex items-center text-h3 font-semibold">
        Panel Colors
        <button
          type="button"
          onClick={resetAll}
          className="ml-auto rounded-xs border border-border-subtle px-2 py-0.5 text-mono-xs text-text-tertiary hover:bg-surface-2"
        >
          Reset all to defaults
        </button>
      </h3>

      {/* Workspace override toggle */}
      <label className="mb-4 flex items-center gap-2 text-body">
        <input
          type="checkbox"
          checked={editingWorkspace}
          onChange={(e) => toggleWorkspaceOverride(e.target.checked)}
        />
        <span>Use custom colors for this workspace</span>
        {editingWorkspace && (
          <span className="ml-1 text-caption text-text-tertiary">
            (editing &ldquo;{activeWs?.name}&rdquo;)
          </span>
        )}
      </label>

      {/* Body-tint level */}
      <div className="mb-4 flex items-center gap-3 text-body">
        <span>Body tint:</span>
        {(["L2", "L3"] as const).map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setBodyTintLevel(level)}
            className={cn(
              "rounded-xs border px-2 py-0.5 text-mono-xs",
              activePrefs.bodyTintLevel === level
                ? "border-accent bg-accent-soft text-text-primary"
                : "border-border-subtle text-text-tertiary hover:bg-surface-2",
            )}
          >
            {level === "L2" ? "Level 2 (default)" : "Level 3 (immersive)"}
          </button>
        ))}
      </div>

      {/* Module rows */}
      <div className="rounded-md border border-border-subtle">
        {MODULES.map((m, idx) => {
          const current =
            activePrefs.colors[m.key] ?? DEFAULT_MODULE_COLORS[m.key];
          const isOverride = m.key in activePrefs.colors;
          return (
            <div
              key={m.key}
              className={cn(
                "flex items-center gap-3 px-3 py-2",
                idx < MODULES.length - 1 && "border-b border-border-subtle",
              )}
            >
              <span
                className="flex size-5 items-center justify-center rounded-xs bg-surface-2 text-text-tertiary"
              >
                <m.Icon size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-body-strong">{m.name}</div>
                <div className="text-caption text-text-tertiary">
                  {m.description}
                </div>
              </div>
              {isOverride && (
                <button
                  type="button"
                  onClick={() => resetModule(m.key)}
                  className="text-mono-xs text-text-tertiary hover:text-text-primary"
                >
                  Reset
                </button>
              )}
              <SwatchPopover
                value={current}
                label={`${m.name} color`}
                onChange={(c) => setModuleColor(m.key, c)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

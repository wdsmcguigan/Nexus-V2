import type { IDockviewPanelProps } from "dockview";

/**
 * Placeholder Tasks panel. Step 1 uses it to prove the dock contribution point
 * renders a real panel; Phase 1 step 2 replaces this body with the task UI.
 */
export function TasksPanel(_: IDockviewPanelProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-text-muted">
      <p className="text-body font-medium text-text-primary">Tasks</p>
      <p className="text-small">Contributed by the org.nexus.tasks module.</p>
    </div>
  );
}

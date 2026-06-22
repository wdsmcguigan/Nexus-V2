import type { IDockviewPanelProps } from "dockview";
import { ClockSection } from "@/modules/timekit/ClockSection";

/** Timekit dock panel. Contributed by the org.nexus.timekit module. */
export function TimekitPanel(_: IDockviewPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <h2 className="text-h3 font-semibold text-text-primary">Clock</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <ClockSection />
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import { cn } from "@/lib/utils";
import { ClockSection } from "@/modules/timekit/ClockSection";
import { TrackerSection } from "@/modules/timekit/TrackerSection";
import { getRequestedSection, subscribeSection, type TimekitSection } from "@/modules/timekit/panelState";

const SECTIONS: { id: TimekitSection; label: string }[] = [
  { id: "clock", label: "Clock" },
  { id: "tracker", label: "Tracker" },
];

/** Timekit dock panel: a tabbed Clock · Tracker (… Timers · Alarms in later stages). */
export function TimekitPanel(_: IDockviewPanelProps) {
  const [section, setSection] = useState<TimekitSection>(() => getRequestedSection());

  // Let commands focus a section on an already-open panel.
  useEffect(() => subscribeSection(setSection), []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <h2 className="text-h3 font-semibold text-text-primary">Clock</h2>
        <div className="flex items-center gap-1 rounded-md bg-surface-2 p-0.5">
          {SECTIONS.map((sct) => (
            <button
              key={sct.id}
              type="button"
              aria-pressed={section === sct.id}
              onClick={() => setSection(sct.id)}
              className={cn(
                "rounded-sm px-2.5 py-1 text-small font-medium transition-colors duration-fast",
                section === sct.id
                  ? "bg-surface-1 text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {sct.label}
            </button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {section === "clock" && <ClockSection />}
        {section === "tracker" && <TrackerSection />}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import type { IDockviewPanelProps } from "dockview";
import { cn } from "@/lib/utils";
import { ClockSection } from "@/modules/timekit/ClockSection";
import { TrackerSection } from "@/modules/timekit/TrackerSection";
import { TimersSection } from "@/modules/timekit/TimersSection";
import { AlarmsSection } from "@/modules/timekit/AlarmsSection";

/** Which section the Timekit panel shows. Owned here now that panelState is gone. */
export type TimekitSection = "clock" | "tracker" | "timers" | "alarms";

const SECTIONS: { id: TimekitSection; label: string }[] = [
  { id: "clock", label: "Clock" },
  { id: "tracker", label: "Tracker" },
  { id: "timers", label: "Timers" },
  { id: "alarms", label: "Alarms" },
];

/** Timekit dock panel: a tabbed Clock · Tracker · Timers · Alarms. */
export function TimekitPanel(props: IDockviewPanelProps) {
  const params = (props.params ?? {}) as { section?: TimekitSection; nonce?: number };
  const [section, setSection] = useState<TimekitSection>(params.section ?? "clock");

  // Re-focus on every command launch (nonce changes each fire) and on a section
  // change; manual tab clicks set local state and are not overridden. Both deps are
  // referenced in the body, so exhaustive-deps stays satisfied.
  useEffect(() => {
    if (params.section) setSection(params.section);
  }, [params.nonce, params.section]);

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
        {section === "timers" && <TimersSection />}
        {section === "alarms" && <AlarmsSection />}
      </div>
    </div>
  );
}

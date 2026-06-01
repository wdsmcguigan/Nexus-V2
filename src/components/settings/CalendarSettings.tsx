import * as React from "react";
import { cn } from "@/lib/utils";
import { CalendarsList } from "./CalendarsList";
import { EventTemplatesSettings } from "./EventTemplatesSettings";

type Tab = "calendars" | "templates";

const TABS: { id: Tab; label: string }[] = [
  { id: "calendars", label: "Calendars" },
  { id: "templates", label: "Event templates" },
];

export function CalendarSettings() {
  const [tab, setTab] = React.useState<Tab>("calendars");

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-border-subtle px-4 pt-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-t-sm border-b-2 px-3 py-1.5 text-small transition-colors",
              tab === t.id
                ? "border-accent text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "calendars" && <CalendarsList />}
      {tab === "templates" && <EventTemplatesSettings />}
    </div>
  );
}

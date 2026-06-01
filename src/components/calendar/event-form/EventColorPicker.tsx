import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { GOOGLE_COLOR_MAP } from "@/lib/calendarColors";

const COLOR_NAMES: Record<string, string> = {
  "1":  "Tomato",
  "2":  "Flamingo",
  "3":  "Tangerine",
  "4":  "Banana",
  "5":  "Sage",
  "6":  "Basil",
  "7":  "Peacock",
  "8":  "Blueberry",
  "9":  "Lavender",
  "10": "Grape",
  "11": "Graphite",
};

interface Props {
  value?: string;
  onChange: (id: string | undefined) => void;
}

/**
 * Event color selector — the 11 Google Calendar event colors plus a "Default"
 * option that clears `colorId` (event renders in its calendar's color).
 * Independent of `src/components/ui/ColorPicker.tsx`, which is the 1–21 label
 * palette.
 */
export function EventColorPicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(undefined)}
        title="Calendar default"
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full border border-border-default bg-surface-1 text-caption text-text-tertiary transition-all",
          !value && "ring-2 ring-accent ring-offset-1 ring-offset-surface-2",
        )}
      >
        <span aria-hidden>—</span>
      </button>
      {Object.entries(GOOGLE_COLOR_MAP).map(([id, hex]) => {
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            title={COLOR_NAMES[id] ?? `Color ${id}`}
            style={{ backgroundColor: hex }}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full transition-all",
              selected && "ring-2 ring-accent ring-offset-1 ring-offset-surface-2",
            )}
          >
            {selected && <Check size={12} className="text-white drop-shadow" />}
          </button>
        );
      })}
    </div>
  );
}

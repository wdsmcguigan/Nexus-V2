import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { Calendar, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DatePickerFieldProps {
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  placeholder?: string;
  className?: string;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function DatePickerField({ value, onChange, placeholder = "Pick a date", className }: DatePickerFieldProps) {
  const [open, setOpen] = React.useState(false);
  const selected = value != null ? new Date(value) : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-xs border border-border-subtle bg-surface-1 px-2",
          "focus-within:border-accent focus-within:shadow-focus",
          className,
        )}
      >
        <Calendar size={11} className="shrink-0 text-text-tertiary" />
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              "flex-1 truncate text-left font-mono text-mono-sm outline-none",
              selected ? "text-text-primary" : "text-text-muted",
            )}
          >
            {selected ? formatDate(selected.getTime()) : placeholder}
          </button>
        </Popover.Trigger>
        {selected && (
          <button
            type="button"
            aria-label="Clear date"
            onClick={() => onChange(undefined)}
            className="shrink-0 text-text-muted hover:text-text-secondary"
          >
            <X size={11} />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="start"
          className={cn(
            "z-50 overflow-hidden rounded-md border border-border-subtle bg-surface-2 p-2 shadow-lg",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(next) => {
              onChange(next ? next.getTime() : undefined);
              if (next) setOpen(false);
            }}
            showOutsideDays
            classNames={{
              root: "rdp text-body text-text-primary",
              month_caption: "flex items-center justify-center h-8 text-body-strong",
              caption_label: "px-2",
              nav: "absolute top-1.5 right-1 flex gap-1",
              button_previous:
                "size-6 rounded-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary",
              button_next:
                "size-6 rounded-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary",
              month_grid: "mt-2 border-collapse",
              weekdays: "text-overline uppercase text-text-tertiary",
              weekday: "size-7 font-normal",
              day: "size-7 p-0 text-small text-text-secondary",
              day_button:
                "size-7 rounded-xs hover:bg-surface-3 hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus",
              selected: "bg-accent text-text-on-accent hover:bg-accent",
              today: "text-accent font-semibold",
              outside: "text-text-muted opacity-50",
              disabled: "text-text-muted opacity-30 cursor-not-allowed",
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

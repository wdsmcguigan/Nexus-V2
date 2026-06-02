import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toCssColor } from "@/lib/panelColors";

interface SwatchPopoverProps {
  /** Current stored value: "link-N" or "#rrggbb". */
  value: string;
  /** Called when the user commits a new color (palette click or valid hex). */
  onChange: (next: string) => void;
  /** ARIA label for the trigger chip. */
  label: string;
}

const PALETTE: Array<{ id: string; name: string }> = [
  { id: "link-1", name: "coral" },
  { id: "link-2", name: "amber" },
  { id: "link-3", name: "lime" },
  { id: "link-4", name: "emerald" },
  { id: "link-5", name: "teal" },
  { id: "link-6", name: "violet" },
  { id: "link-7", name: "rose" },
  { id: "link-8", name: "slate" },
  { id: "link-9", name: "crimson" },
  { id: "link-10", name: "orange" },
  { id: "link-11", name: "yellow" },
  { id: "link-12", name: "sage" },
  { id: "link-13", name: "forest" },
  { id: "link-14", name: "seafoam" },
  { id: "link-15", name: "sky" },
  { id: "link-16", name: "blue" },
  { id: "link-17", name: "indigo" },
  { id: "link-18", name: "grape" },
  { id: "link-19", name: "fuchsia" },
  { id: "link-20", name: "blush" },
  { id: "link-21", name: "steel" },
];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function SwatchPopover({ value, onChange, label }: SwatchPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [customHex, setCustomHex] = React.useState("");
  const [hexError, setHexError] = React.useState(false);

  const isCustom = !value.startsWith("link-");

  React.useEffect(() => {
    // Reset custom-hex input whenever the popover opens, showing the current
    // hex if applicable.
    if (open) {
      setCustomHex(isCustom ? value : "");
      setHexError(false);
    }
  }, [open, value, isCustom]);

  const commitHex = () => {
    const trimmed = customHex.trim();
    if (!HEX_RE.test(trimmed)) {
      setHexError(true);
      return;
    }
    onChange(trimmed);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "size-[22px] rounded-xs border border-border-default",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
          style={{ background: toCssColor(value) }}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 rounded-md border border-border-default bg-surface-2 p-2.5 shadow-l2"
        >
          <div className="grid grid-cols-7 gap-1.5">
            {PALETTE.map((p) => {
              const selected = p.id === value;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-label={p.name}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "size-[22px] rounded-xs border border-border-subtle",
                    "relative focus-visible:outline-none focus-visible:shadow-focus",
                  )}
                  style={{ background: toCssColor(p.id) }}
                >
                  {selected && (
                    <Check
                      size={12}
                      className="absolute inset-0 m-auto text-white drop-shadow"
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 border-t border-border-subtle pt-2">
            <label className="flex items-center gap-2 text-mono-xs text-text-tertiary">
              <span className="shrink-0">+ Custom hex</span>
              <input
                value={customHex}
                onChange={(e) => {
                  setCustomHex(e.target.value);
                  setHexError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitHex();
                  }
                }}
                placeholder="#aabbcc"
                className={cn(
                  "h-6 flex-1 rounded-xs border bg-surface-3 px-1.5 font-mono text-mono-xs",
                  hexError ? "border-danger" : "border-border-subtle",
                )}
              />
              <button
                type="button"
                onClick={commitHex}
                className="rounded-xs border border-border-subtle px-1.5 py-px text-mono-xs hover:bg-surface-3"
              >
                Set
              </button>
            </label>
            {hexError && (
              <div className="mt-1 text-caption text-danger">
                Use 3- or 6-digit hex like #aabbcc
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

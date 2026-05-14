/**
 * 8-slot color picker for labels, folders, and statuses.
 * Renders a row of color dots; selected dot has a ring.
 */
// ColorPicker renders interactive color swatches — no React state import needed.
import { cn } from "@/lib/utils";

interface ColorPickerProps {
  value: number; // 1..8
  onChange: (color: number) => void;
  className?: string;
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  return (
    <div className={cn("flex gap-1", className)}>
      {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${c}`}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={cn(
            "size-5 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            value === c ? "border-text-primary" : "border-transparent",
          )}
          style={{ backgroundColor: `var(--color-link-${c})` }}
        />
      ))}
    </div>
  );
}

import { cn } from "@/lib/utils";

interface ColorPickerProps {
  value: number; // 1..21
  onChange: (color: number) => void;
  className?: string;
}

const ROWS = [
  [1, 2, 3, 4, 5, 6, 7] as const,
  [8, 9, 10, 11, 12, 13, 14] as const,
  [15, 16, 17, 18, 19, 20, 21] as const,
] as const;

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {ROWS.map((row, ri) => (
        <div key={ri} className="flex gap-1">
          {row.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              aria-pressed={value === c}
              onClick={() => onChange(c)}
              className={cn(
                "size-4 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                value === c ? "border-text-primary" : "border-transparent",
              )}
              style={{ backgroundColor: `var(--color-link-${c})` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

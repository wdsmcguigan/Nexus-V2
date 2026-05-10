import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PanelLink } from "@/design-system/tokens";

interface TagProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> {
  color?: PanelLink;
  size?: "sm" | "md";
  removable?: boolean;
  onRemove?: () => void;
  selected?: boolean;
}

const COLOR_VAR: Record<PanelLink, string> = {
  1: "var(--color-link-1)",
  2: "var(--color-link-2)",
  3: "var(--color-link-3)",
  4: "var(--color-link-4)",
  5: "var(--color-link-5)",
  6: "var(--color-link-6)",
  7: "var(--color-link-7)",
  8: "var(--color-link-8)",
};

/**
 * Tag / label pill — see spec §3.5.
 * Soundminer-style square (radius-xs), uppercase mono text.
 */
export function Tag({
  color = 8,
  size = "sm",
  removable,
  onRemove,
  selected,
  className,
  children,
  style,
  ...props
}: TagProps) {
  const hue = COLOR_VAR[color];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-xs font-mono uppercase",
        "tracking-[0.04em] leading-none",
        size === "sm" && "h-[18px] px-1.5 text-mono-xs gap-1",
        size === "md" && "h-[22px] px-2 text-mono-xs gap-1.5",
        "transition-colors duration-fast ease-out",
        className,
      )}
      style={{
        color: hue,
        backgroundColor: `color-mix(in oklch, ${hue} ${selected ? 28 : 18}%, transparent)`,
        border: selected ? `1px solid color-mix(in oklch, ${hue} 70%, transparent)` : undefined,
        ...style,
      }}
      {...props}
    >
      {children}
      {removable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
          className="ml-px -mr-0.5 rounded-xs p-px opacity-dim hover:opacity-full focus-visible:opacity-full focus-visible:shadow-focus"
          aria-label="Remove tag"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

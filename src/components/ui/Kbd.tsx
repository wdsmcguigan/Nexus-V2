import * as React from "react";
import { cn } from "@/lib/utils";

interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  size?: "xs" | "sm";
}

/** Small monospace key chip used in tooltips and command palette. */
export function Kbd({ size = "xs", className, children, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded-xs font-mono font-semibold",
        "bg-surface-inset text-text-tertiary",
        "border border-border-subtle",
        size === "xs" && "h-4 min-w-[16px] px-1 text-mono-xs",
        size === "sm" && "h-5 min-w-[20px] px-1.5 text-mono-sm",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

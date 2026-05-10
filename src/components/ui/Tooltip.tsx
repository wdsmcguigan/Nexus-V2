import * as React from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = RadixTooltip.Provider;

interface TooltipProps {
  label: React.ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delay?: number;
  children: React.ReactNode;
}

/** Tooltip — appears at 600ms hover, immediately on keyboard focus. */
export function Tooltip({
  label,
  shortcut,
  side = "top",
  align = "center",
  delay = 600,
  children,
}: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={delay}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={8}
          className={cn(
            "z-[100] max-w-60 rounded-sm bg-surface-4 px-2 py-1",
            "text-small text-text-primary shadow-l4",
            "border border-border-default",
            "data-[state=delayed-open]:animate-toast-in",
          )}
        >
          <div className="flex items-center gap-2">
            <span>{label}</span>
            {shortcut && (
              <kbd className="rounded-xs bg-surface-inset px-1 py-px font-mono text-mono-xs text-text-tertiary">
                {shortcut}
              </kbd>
            )}
          </div>
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

import * as React from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface PanelHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  meta?: React.ReactNode;
  /** Right-aligned actions slot. */
  actions?: React.ReactNode;
  /** Hide the drag handle (e.g. for Navigation). */
  hideHandle?: boolean;
  /** Compact 28px header (HUD). */
  compact?: boolean;
}

/** Panel header — see spec §4.3. */
export function PanelHeader({
  title,
  meta,
  actions,
  hideHandle,
  compact,
  className,
  ...props
}: PanelHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center gap-2 border-b border-border-subtle bg-surface-1 px-2",
        compact ? "h-7" : "h-8",
        // panel-focused border boost
        "panel-focused:border-border-default",
        // accent strip on top inside when focused
        "relative",
        "panel-focused:before:absolute panel-focused:before:inset-x-0 panel-focused:before:top-0 panel-focused:before:h-0.5 panel-focused:before:bg-accent",
        className,
      )}
      {...props}
    >
      {!hideHandle && (
        <button
          aria-label="Drag panel"
          tabIndex={-1}
          className={cn(
            "shrink-0 cursor-grab active:cursor-grabbing",
            "text-text-tertiary opacity-dim-strong",
            "transition-opacity duration-fast",
            "hover:opacity-full focus-visible:opacity-full focus-visible:shadow-focus",
            "rounded-xs",
          )}
        >
          <GripVertical size={14} />
        </button>
      )}
      <h2
        className={cn(
          "truncate font-sans text-h3 font-semibold",
          "text-text-tertiary panel-focused:text-text-primary",
          "transition-colors duration-fast",
        )}
      >
        {title}
        {meta && (
          <span className="ml-1 font-normal text-text-muted">
            <span className="mx-1 select-none">·</span>
            <span className="font-mono text-mono-sm">{meta}</span>
          </span>
        )}
      </h2>
      {actions && (
        <div className="ml-auto flex shrink-0 items-center gap-1 opacity-dim panel-focused:opacity-full transition-opacity duration-fast">
          {actions}
        </div>
      )}
    </header>
  );
}

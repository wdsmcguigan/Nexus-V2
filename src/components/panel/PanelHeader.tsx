import * as React from "react";
import { cn } from "@/lib/utils";

interface PanelHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  meta?: React.ReactNode;
  /** Right-aligned actions slot. */
  actions?: React.ReactNode;
  /** @deprecated no-op — drag handle is now in the dockview tab bar */
  hideHandle?: boolean;
  /** Compact 28px header (HUD). */
  compact?: boolean;
}

/** Panel header — see spec §4.3. */
export function PanelHeader({
  title,
  meta,
  actions,
  compact,
  className,
  ...props
}: PanelHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center gap-2 border-b border-border-subtle bg-surface-1 px-3",
        compact ? "h-7" : "h-8",
        "panel-focused:border-border-default",
        "relative",
        // Note: a `panel-focused:before:bg-accent` 2px top accent line was
        // removed here — the module-color tab-bar wash + active-tab
        // underline added by the panel-color-identity feature now carry
        // the focus signal on their own.
        className,
      )}
      {...props}
    >
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

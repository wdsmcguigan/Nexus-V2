import * as React from "react";
import { cn } from "@/lib/utils";
import type { PanelType } from "@/design-system/tokens";
import { useWorkspace } from "@/state/workspace";

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stable id for focus-tracking. */
  panelId: string;
  type: PanelType;
  /** Show inline progress bar at the bottom of the header. */
  loading?: boolean;
  /** Show panel-link strip on the inside-left of the header. */
  linkColor?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** Slot for panel header. Receives `focused` boolean via context. */
  header?: React.ReactNode;
  /** Whether this is a docked or floating panel (affects shadow). */
  floating?: boolean;
  children: React.ReactNode;
}

/**
 * Panel container — see spec §4.2.
 * Applies data-panel-focused for Contextual Ghosting.
 */
export function Panel({
  panelId,
  type,
  loading,
  linkColor,
  header,
  floating,
  className,
  children,
  ...props
}: PanelProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const activePanelId = useWorkspace((s) => s.activePanelId);
  const setActivePanel = useWorkspace((s) => s.setActivePanel);
  const isFocused = activePanelId === panelId;

  const handleFocusCapture = React.useCallback(() => {
    if (activePanelId !== panelId) setActivePanel(panelId);
  }, [activePanelId, panelId, setActivePanel]);

  const handleMouseDownCapture = React.useCallback(() => {
    if (activePanelId !== panelId) setActivePanel(panelId);
  }, [activePanelId, panelId, setActivePanel]);

  return (
    <section
      ref={ref}
      role="region"
      aria-label={typeof header === "string" ? header : undefined}
      data-panel-focused={isFocused}
      data-panel-id={panelId}
      data-panel-type={type}
      tabIndex={-1}
      onFocusCapture={handleFocusCapture}
      onMouseDownCapture={handleMouseDownCapture}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden bg-surface-1",
        "rounded-md",
        floating ? "shadow-l2 border border-border-default" : "shadow-l1",
        // contain helps Container Queries scope cleanly
        "[contain:layout_paint] [container-type:inline-size]",
        className,
      )}
      {...props}
    >
      {header && (
        <div className="relative shrink-0">
          {linkColor && (
            <span
              aria-hidden
              className="absolute left-0 top-0 h-full w-[3px]"
              style={{ backgroundColor: `var(--color-link-${linkColor})` }}
            />
          )}
          {header}
          {loading && (
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-px left-0 right-0 h-0.5 overflow-hidden"
            >
              <div
                className="h-full w-1/3 animate-panel-progress"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, var(--color-accent), transparent)",
                }}
              />
            </div>
          )}
        </div>
      )}
      <div className="panel-body flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

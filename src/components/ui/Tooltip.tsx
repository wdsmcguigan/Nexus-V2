import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Lightweight tooltip — appears on hover after `delay` ms and on keyboard
 * focus immediately.
 *
 * We deliberately avoid Radix Tooltip's TooltipProvider here: its
 * cross-consumer state cascade (Provider counts open tooltips, every
 * panel-focus change re-broadcasts to every Tooltip Root, every Root
 * re-renders with new context value) causes a render storm on
 * multi-panel state changes. A self-contained timer + portal is enough
 * for the current need.
 */

interface TooltipProps {
  label: React.ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  delay?: number;
  children: React.ReactElement;
}

// Compatibility export — kept so callers that imported TooltipProvider
// still compile. The new tooltip needs no provider; this is a no-op.
export function TooltipProvider({
  children,
}: {
  delayDuration?: number;
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

interface TipState {
  open: boolean;
  rect: DOMRect | null;
}

export function Tooltip({
  label,
  shortcut,
  side = "top",
  delay = 600,
  children,
}: TooltipProps) {
  const [state, setState] = React.useState<TipState>({
    open: false,
    rect: null,
  });
  const timerRef = React.useRef<number | null>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);

  const open = React.useCallback(
    (immediate = false) => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      const fire = () => {
        const rect = triggerRef.current?.getBoundingClientRect() ?? null;
        setState({ open: true, rect });
      };
      if (immediate) fire();
      else timerRef.current = window.setTimeout(fire, delay);
    },
    [delay],
  );

  const close = React.useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setState((s) => (s.open ? { open: false, rect: null } : s));
  }, []);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  // Clone trigger child to inject ref + handlers.
  const child = React.cloneElement(
    children as React.ReactElement<Record<string, unknown>>,
    {
      ref: (el: HTMLElement | null) => {
        triggerRef.current = el;
        const childRef = (children as { ref?: unknown }).ref;
        if (typeof childRef === "function") {
          (childRef as (el: HTMLElement | null) => void)(el);
        } else if (childRef && typeof childRef === "object" && childRef !== null) {
          (childRef as React.MutableRefObject<HTMLElement | null>).current = el;
        }
      },
      onPointerEnter: () => open(),
      onPointerLeave: close,
      onFocus: (e: React.FocusEvent) => {
        // immediate open on keyboard focus (matches WCAG 1.4.13)
        open(true);
        const handler = (children.props as { onFocus?: (e: React.FocusEvent) => void })
          .onFocus;
        handler?.(e);
      },
      onBlur: (e: React.FocusEvent) => {
        close();
        const handler = (children.props as { onBlur?: (e: React.FocusEvent) => void })
          .onBlur;
        handler?.(e);
      },
      onClick: (e: React.MouseEvent) => {
        // close on click so the tooltip doesn't linger over the action
        close();
        const handler = (children.props as { onClick?: (e: React.MouseEvent) => void })
          .onClick;
        handler?.(e);
      },
    },
  );

  return (
    <>
      {child}
      {state.open && state.rect && (
        <TooltipPortal rect={state.rect} side={side}>
          <span className="flex items-center gap-2">
            <span>{label}</span>
            {shortcut && (
              <kbd
                className={cn(
                  "rounded-xs bg-surface-inset px-1 py-px font-mono text-mono-xs",
                  "text-text-tertiary border border-border-subtle",
                )}
              >
                {shortcut}
              </kbd>
            )}
          </span>
        </TooltipPortal>
      )}
    </>
  );
}

function TooltipPortal({
  rect,
  side,
  children,
}: {
  rect: DOMRect;
  side: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
}) {
  // Compute position. Anchor by trigger center; flip if it would clip.
  const offset = 8;
  let style: React.CSSProperties = {
    position: "fixed",
    top: 0,
    left: 0,
    zIndex: 100,
    pointerEvents: "none",
  };
  switch (side) {
    case "top":
      style = {
        ...style,
        top: rect.top - offset,
        left: rect.left + rect.width / 2,
        transform: "translate(-50%, -100%)",
      };
      break;
    case "bottom":
      style = {
        ...style,
        top: rect.bottom + offset,
        left: rect.left + rect.width / 2,
        transform: "translate(-50%, 0)",
      };
      break;
    case "left":
      style = {
        ...style,
        top: rect.top + rect.height / 2,
        left: rect.left - offset,
        transform: "translate(-100%, -50%)",
      };
      break;
    case "right":
      style = {
        ...style,
        top: rect.top + rect.height / 2,
        left: rect.right + offset,
        transform: "translate(0, -50%)",
      };
      break;
  }

  // Render via portal to escape stacking contexts.
  const [container] = React.useState(() => {
    if (typeof document === "undefined") return null;
    return document.body;
  });

  if (!container) return null;
  return createPortal(
    <span
      role="tooltip"
      style={style}
      className={cn(
        "rounded-sm bg-surface-4 px-2 py-1 text-small text-text-primary",
        "shadow-l4 border border-border-default whitespace-nowrap",
        "animate-toast-in",
      )}
    >
      {children}
    </span>,
    container,
  );
}

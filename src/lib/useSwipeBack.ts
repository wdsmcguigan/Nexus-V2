import * as React from "react";

interface Options {
  enabled?: boolean;
  edgeWidth?: number;
  threshold?: number;
}

/**
 * Pointer-based swipe-right-from-left-edge gesture. Calls `onSwipeBack`
 * when the user starts a drag from within `edgeWidth` of the element's
 * left edge and moves at least `threshold` pixels to the right.
 */
export function useSwipeBack<T extends HTMLElement>(
  onSwipeBack: () => void,
  { enabled = true, edgeWidth = 32, threshold = 80 }: Options = {},
) {
  const ref = React.useRef<T | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let startX = 0;
    let startY = 0;
    let active = false;

    function onDown(e: PointerEvent) {
      if (e.pointerType === "mouse") return;
      const rect = el!.getBoundingClientRect();
      if (e.clientX - rect.left > edgeWidth) return;
      active = true;
      startX = e.clientX;
      startY = e.clientY;
    }

    function onUp(e: PointerEvent) {
      if (!active) return;
      active = false;
      const dx = e.clientX - startX;
      const dy = Math.abs(e.clientY - startY);
      if (dx > threshold && dy < threshold) onSwipeBack();
    }

    function onCancel() {
      active = false;
    }

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
    };
  }, [onSwipeBack, enabled, edgeWidth, threshold]);

  return ref;
}

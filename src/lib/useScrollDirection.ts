import * as React from "react";

export type ScrollDirection = "up" | "down" | "idle";

interface Options {
  threshold?: number;
  topThreshold?: number;
}

/**
 * Tracks scroll direction on the element returned by `getScrollEl`. The
 * getter is re-resolved whenever `deps` change (so swapping which panel
 * is mounted re-attaches the listener).
 */
export function useScrollDirection(
  getScrollEl: () => HTMLElement | null,
  deps: React.DependencyList,
  { threshold = 6, topThreshold = 24 }: Options = {},
): ScrollDirection {
  const [direction, setDirection] = React.useState<ScrollDirection>("idle");

  React.useEffect(() => {
    const el = getScrollEl();
    if (!el) {
      setDirection("idle");
      return;
    }
    let lastY = el.scrollTop;
    function onScroll() {
      const y = el!.scrollTop;
      if (y < topThreshold) {
        setDirection("up");
        lastY = y;
        return;
      }
      const dy = y - lastY;
      if (Math.abs(dy) < threshold) return;
      setDirection(dy > 0 ? "down" : "up");
      lastY = y;
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return direction;
}

import * as React from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/Tooltip";
import { PopoutComposer } from "@/windows/PopoutComposer";
import { PopoutPanelHost } from "@/windows/PopoutPanelHost";
import {
  closePopoutWindow,
  emitPopoutClosed,
  emitPopoutGeometry,
  getWindowGeometry,
  type PopoutKind,
} from "@/storage/tauri";

/**
 * Root for every de-docked OS window. Provides the shared providers (theme is
 * already applied to <html> at store module-load), routes by pop-out `kind`,
 * wires ⌘W to close, and notifies the main window when this window closes so
 * it can untrack the detached panel.
 */
export function PopoutHost({ label }: { label: string }) {
  const kind = (label.split("-")[1] ?? "panel") as PopoutKind;

  // ⌘W / Ctrl+W closes the pop-out (not the whole app).
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        void closePopoutWindow(label);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [label]);

  // Tell the main window when we close (OS chrome or ⌘W) so it untracks us.
  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      unlisten = await getCurrentWebviewWindow().onCloseRequested(() => {
        void emitPopoutClosed(label);
      });
    })();
    return () => unlisten?.();
  }, [label]);

  // Report geometry (debounced) on move/resize so the main window can persist
  // it for multi-monitor restore on next launch.
  React.useEffect(() => {
    let unMove: (() => void) | undefined;
    let unResize: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const report = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const g = await getWindowGeometry(label).catch(() => null);
        if (g) await emitPopoutGeometry(label, g);
      }, 600);
    };
    (async () => {
      const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const w = getCurrentWebviewWindow();
      unMove = await w.onMoved(report);
      unResize = await w.onResized(report);
      report(); // capture the initial placement once
    })();
    return () => {
      unMove?.();
      unResize?.();
      if (timer) clearTimeout(timer);
    };
  }, [label]);

  return (
    <TooltipProvider delayDuration={600}>
      <div className="dv-theme-nexus h-screen w-screen bg-canvas text-text-primary">
        {kind === "composer" ? (
          <PopoutComposer label={label} />
        ) : (
          <PopoutPanelHost label={label} />
        )}
      </div>
      <Toaster position="bottom-right" theme="system" />
    </TooltipProvider>
  );
}

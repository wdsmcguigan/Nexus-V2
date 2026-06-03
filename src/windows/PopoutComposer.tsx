import * as React from "react";
import { EmailComposerPanel } from "@/components/email/EmailComposerPanel";
import { useWorkspace, type ComposerContext } from "@/state/workspace";
import { closePopoutWindow, takePopoutPayload } from "@/storage/tauri";

/**
 * Hosts the composer in a detached OS window. On mount it pulls the
 * {@link ComposerContext} stashed at window-creation time and seeds the local
 * store, then renders the standard {@link EmailComposerPanel}. When the
 * composer closes (send / discard flips `composerOpen` to false) the window
 * closes itself.
 */
export function PopoutComposer({ label }: { label: string }) {
  const [ready, setReady] = React.useState(false);
  const composerOpen = useWorkspace((s) => s.composerOpen);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const envelope = await takePopoutPayload(label).catch(() => null);
      if (cancelled) return;
      let ctx: ComposerContext | undefined;
      if (envelope?.payload) {
        try {
          ctx = JSON.parse(envelope.payload) as ComposerContext;
        } catch {
          ctx = undefined;
        }
      }
      useWorkspace.getState().openComposer(ctx);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [label]);

  // Once seeded, a transition back to closed means the user sent or discarded.
  React.useEffect(() => {
    if (ready && !composerOpen) {
      void closePopoutWindow(label);
    }
  }, [ready, composerOpen, label]);

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300" />
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-canvas text-text-primary">
      <EmailComposerPanel />
    </div>
  );
}

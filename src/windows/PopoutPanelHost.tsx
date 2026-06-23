import * as React from "react";
import { EmailViewerPanel } from "@/components/email/EmailViewerPanel";
import { EmailComposerPanel } from "@/components/email/EmailComposerPanel";
import { EmailListPanel } from "@/components/email/EmailListPanel";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { ContactsPanel } from "@/components/contacts/ContactsPanel";
import { CalendarPanel } from "@/components/calendar/CalendarPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { useWorkspace } from "@/state/workspace";
import { takePopoutPayload, decodeModulePopoutPayload, type PopoutKind } from "@/storage/tauri";
import type { IDockviewPanelProps } from "dockview";
import { dockSurfaceComponents } from "@/modules/surfaceRegistry";

// Synthetic, window-local panel ids. A pop-out has its own React root and no
// shared dockview, so panel-keyed state (pin/inspector association) is scoped
// to these fixed ids.
const VIEWER_ID = "popout-viewer";
const INSPECTOR_ID = "popout-inspector";
const LIST_ID = "popout-list";
const CONTACTS_ID = "popout-contacts";
const SETTINGS_ID = "popout-settings";

/**
 * Hosts a single de-docked panel (viewer / inspector / list / contacts /
 * calendar / settings) in its own OS window. Renders the same panel components
 * as the main workspace, reading this window's own (hydrated + synced) store.
 *
 * For viewer/inspector the detached message id is seeded into selection so the
 * panel shows the right message immediately; the viewer is additionally pinned
 * so it stays put regardless of later selection changes (pinned-viewer
 * semantics, reused rather than reinvented).
 */
export function PopoutPanelHost({ label }: { label: string }) {
  const kind = (label.split("-")[1] ?? "panel") as PopoutKind;
  const [ready, setReady] = React.useState(false);
  const [modulePayload, setModulePayload] = React.useState<string | null>(null);
  const composerOpen = useWorkspace((s) => s.composerOpen);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const env = await takePopoutPayload(label).catch(() => null);
      if (cancelled) return;
      const targetId = env?.targetId ?? null;
      setModulePayload(env?.payload ?? null);
      if (targetId) {
        useWorkspace.getState().setSelectedEmail(targetId);
        if (kind === "viewer") useWorkspace.getState().pinViewerToEmail(VIEWER_ID, targetId);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [label, kind]);

  if (!ready) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-canvas">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300" />
      </div>
    );
  }

  switch (kind) {
    case "viewer":
      // Mirror the main workspace's viewer slot: a reply swaps in the composer.
      return composerOpen ? <EmailComposerPanel /> : <EmailViewerPanel panelId={VIEWER_ID} />;
    case "inspector":
      return <InspectorPanel panelId={INSPECTOR_ID} />;
    case "list":
      return <EmailListPanel panelId={LIST_ID} />;
    case "contacts":
      return <ContactsPanel panelId={CONTACTS_ID} />;
    case "calendar":
      return <CalendarPanel />;
    case "settings":
      return <SettingsPanel panelId={SETTINGS_ID} />;
    case "module": {
      const parsed = decodeModulePopoutPayload(modulePayload);
      const Comp = parsed ? dockSurfaceComponents()[parsed.componentKey] : undefined;
      if (!Comp) {
        return (
          <div className="flex h-full w-full items-center justify-center text-text-muted">
            Unsupported window type
          </div>
        );
      }
      // Module surfaces are dockview panel components; outside dockview we supply a
      // minimal stub (params only — current modules don't read the dockview api).
      return <Comp {...({ params: {} } as unknown as IDockviewPanelProps)} />;
    }
    default:
      return (
        <div className="flex h-full w-full items-center justify-center text-text-muted">
          Unsupported window type
        </div>
      );
  }
}

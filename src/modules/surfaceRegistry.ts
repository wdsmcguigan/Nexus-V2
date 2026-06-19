/**
 * Host-side registry of dock surfaces contributed by modules. A JSON manifest
 * can't carry a React component, so the component is paired with its declared
 * spec here at registration time. `Workspace.tsx` merges these into dockview's
 * component map; `openModulePanel` launches one. (substrate §7.2, Pillar 4.)
 */
import type { FunctionComponent } from "react";
import type { IDockviewPanelProps } from "dockview";
import type { SurfaceSpec } from "@/modules/surfaces";

/** A dock surface's React component — rendered by dockview as panel content. */
export type DockSurfaceComponent = FunctionComponent<IDockviewPanelProps>;

/** A registered dock surface: its spec, owning module, and rendering component. */
export interface RegisteredDockSurface {
  moduleId: string;
  spec: SurfaceSpec;
  /** The dockview component key and panel id: `${moduleId}:${spec.id}`. */
  componentKey: string;
  component: DockSurfaceComponent;
}

const _dockSurfaces = new Map<string, RegisteredDockSurface>();

/** The dockview component key / panel id for a module surface. */
export function dockComponentKey(moduleId: string, surfaceId: string): string {
  return `${moduleId}:${surfaceId}`;
}

/**
 * True if `panelId` is a module dock-surface panel id (namespaced as
 * `${moduleId}:${surfaceId}` by `dockComponentKey`), as opposed to a core panel
 * id like "nav" / "list" / "viewer-2". Core panel ids never contain ":".
 */
export function isModulePanelId(panelId: string): boolean {
  return panelId.includes(":");
}

/**
 * Register a dock surface paired with its component. Returns a disposer.
 * Throws if a surface is already registered under the same key.
 */
export function registerDockSurface(
  moduleId: string,
  spec: SurfaceSpec,
  component: DockSurfaceComponent,
): () => void {
  const componentKey = dockComponentKey(moduleId, spec.id);
  if (_dockSurfaces.has(componentKey)) {
    throw new Error(`A dock surface is already registered for "${componentKey}"`);
  }
  _dockSurfaces.set(componentKey, { moduleId, spec, componentKey, component });
  return () => {
    _dockSurfaces.delete(componentKey);
  };
}

/** All registered dock surfaces. */
export function listDockSurfaces(): RegisteredDockSurface[] {
  return [..._dockSurfaces.values()];
}

/** A dockview-ready map of componentKey → component for the current surfaces. */
export function dockSurfaceComponents(): Record<string, DockSurfaceComponent> {
  const out: Record<string, DockSurfaceComponent> = {};
  for (const s of _dockSurfaces.values()) out[s.componentKey] = s.component;
  return out;
}

/** Test-only: clear all registered dock surfaces. */
export function _resetDockSurfaces(): void {
  _dockSurfaces.clear();
}

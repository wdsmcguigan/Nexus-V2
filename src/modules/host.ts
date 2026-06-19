/**
 * The host handle a module receives at registration (substrate Appendix B, P2).
 * In the eventual sandboxed world a third-party module talks to the host ONLY
 * through a handle like this; core modules dogfood the same shape. The set of
 * surfaces it can bind is fixed by the manifest (gated before this runs) — the
 * handle only binds implementations. Carries `registerReducer` +
 * `contribute.surface` for now; grows with real consumers (P6/YAGNI).
 */
import { registerModuleReducer, type ModuleReducer } from "@/state/moduleReducers";
import { registerModuleInverse, type ModuleInverseBuilder } from "@/state/mutations";
import { registerDockSurface, type DockSurfaceComponent } from "@/modules/surfaceRegistry";
import type { SurfaceSpec } from "@/modules/surfaces";

export interface ModuleHost {
  /** Register this module's reducer under its namespace (substrate Pillar 1). */
  registerReducer(reducer: ModuleReducer): void;
  /** Register an inverse-builder so this module's mutations undo (substrate §4.3). */
  registerInverse(builder: ModuleInverseBuilder): void;
  contribute: {
    /**
     * Bind a React component to a surface the manifest already declared.
     * Throws if `surfaceId` was not declared, or its type is not yet wired.
     */
    surface(surfaceId: string, component: DockSurfaceComponent): void;
  };
}

/**
 * Build a host scoped to one module, collecting disposers so the registry can
 * tear down everything the module contributed. `declaredSurfaces` is the
 * manifest's surfaces, already trust-gated by the caller.
 */
export function createModuleHost(
  moduleId: string,
  namespace: string,
  declaredSurfaces: Map<string, SurfaceSpec>,
): { host: ModuleHost; dispose: () => void } {
  const disposers: Array<() => void> = [];

  const host: ModuleHost = {
    registerReducer(reducer) {
      disposers.push(registerModuleReducer(namespace, reducer));
    },
    registerInverse(builder) {
      disposers.push(registerModuleInverse(namespace, builder));
    },
    contribute: {
      surface(surfaceId, component) {
        const spec = declaredSurfaces.get(surfaceId);
        if (!spec) {
          throw new Error(`Surface "${surfaceId}" is not declared in module "${moduleId}" manifest`);
        }
        if (spec.type !== "dock") {
          throw new Error(`Surface type "${spec.type}" is not wired yet (only "dock" in v1)`);
        }
        disposers.push(registerDockSurface(moduleId, spec, component));
      },
    },
  };

  const dispose = () => {
    for (const d of [...disposers].reverse()) d();
  };
  return { host, dispose };
}

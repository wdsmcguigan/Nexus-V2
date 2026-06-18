import { registerModuleReducer, type ModuleReducer } from "@/state/moduleReducers";
import { kindNamespace } from "@/state/mutationKind";
import type { TrustTier } from "@/modules/surfaces";

/** A module's declared manifest (substrate §7.1). */
export interface ModuleManifest {
  id: string;
  name: string;
  version: string;
  /** Reverse-DNS namespace owning this module's kinds, entities, and storage. */
  namespace: string;
  /** ENT types this module owns, each prefixed with `${namespace}/`. */
  entities: string[];
  /** Mutation kinds this module emits, each prefixed with `${namespace}/`. */
  mutationKinds: string[];
  /** Capability requests (vocabulary now, enforced later — substrate §7.3). */
  capabilities: Record<string, unknown>;
  trust: TrustTier;
}

interface RegisteredModule {
  manifest: ModuleManifest;
  dispose: () => void;
}

const _modules = new Map<string, RegisteredModule>();

function assertNamespaced(items: string[], namespace: string, label: string): void {
  const prefix = `${namespace}/`;
  for (const item of items) {
    if (kindNamespace(item) !== namespace || !item.startsWith(prefix)) {
      throw new Error(`${label} "${item}" is outside module namespace "${namespace}"`);
    }
  }
}

/**
 * Register a module from its manifest, optionally wiring its reducer under the
 * module namespace. Validates that all declared kinds and entities live in the
 * module's namespace. Returns a disposer that unregisters the module and its
 * reducer. (substrate Pillar 4, §7)
 */
export function registerModule(manifest: ModuleManifest, reducer?: ModuleReducer): () => void {
  if (_modules.has(manifest.id)) {
    throw new Error(`A module is already registered with id "${manifest.id}"`);
  }
  assertNamespaced(manifest.mutationKinds, manifest.namespace, "mutationKind");
  assertNamespaced(manifest.entities, manifest.namespace, "entity");

  const disposeReducer = reducer
    ? registerModuleReducer(manifest.namespace, reducer)
    : () => {};

  const dispose = () => {
    disposeReducer();
    _modules.delete(manifest.id);
  };
  _modules.set(manifest.id, { manifest, dispose });
  return dispose;
}

/** Returns the manifest of the registered module with `id`, or undefined. */
export function getModule(id: string): ModuleManifest | undefined {
  return _modules.get(id)?.manifest;
}

/** All registered module manifests. */
export function listModules(): ModuleManifest[] {
  return [..._modules.values()].map((m) => m.manifest);
}

/** Test-only: unregister all modules, disposing each module's reducer too. */
export function _resetModules(): void {
  for (const m of [..._modules.values()]) m.dispose();
  _modules.clear();
}

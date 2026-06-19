import { kindNamespace } from "@/state/mutationKind";
import { canContributeSurface, type SurfaceSpec, type TrustTier } from "@/modules/surfaces";
import { createModuleHost, type ModuleHost } from "@/modules/host";
import type { ModuleCommandSpec } from "@/modules/commands";

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
  /**
   * UI surfaces and commands this module declares (substrate §7.2). The manifest is the
   * gateable, serializable declaration; components/handlers are bound at registration
   * via the host (gate-before-run security posture).
   */
  contributes?: { surfaces?: SurfaceSpec[]; commands?: ModuleCommandSpec[] };
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
 * Register a module from its manifest. The optional `setup` callback receives a
 * capability-scoped host (substrate Appendix B) to register its reducer and
 * bind components to the surfaces the manifest declared. Validates namespacing
 * and trust×surface gating BEFORE running setup (gate-before-run). Returns a
 * disposer that unregisters the module, its reducer, and its surfaces.
 * (substrate Pillar 4, §7)
 */
export function registerModule(
  manifest: ModuleManifest,
  setup?: (host: ModuleHost) => void,
): () => void {
  if (_modules.has(manifest.id)) {
    throw new Error(`A module is already registered with id "${manifest.id}"`);
  }
  assertNamespaced(manifest.mutationKinds, manifest.namespace, "mutationKind");
  assertNamespaced(manifest.entities, manifest.namespace, "entity");

  const declared = new Map<string, SurfaceSpec>();
  for (const spec of manifest.contributes?.surfaces ?? []) {
    if (!canContributeSurface(manifest.trust, spec.type)) {
      throw new Error(
        `Module "${manifest.id}" (${manifest.trust}) may not contribute a "${spec.type}" surface`,
      );
    }
    declared.set(spec.id, spec);
  }

  const declaredCommands = new Map<string, ModuleCommandSpec>();
  for (const c of manifest.contributes?.commands ?? []) declaredCommands.set(c.id, c);

  const { host, dispose: disposeHost } = createModuleHost(
    manifest.id,
    manifest.namespace,
    declared,
    declaredCommands,
  );
  if (setup) {
    try {
      setup(host);
    } catch (err) {
      disposeHost();
      throw err;
    }
  }

  const dispose = () => {
    disposeHost();
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

/** Test-only: unregister all modules, disposing each module's reducer + surfaces. */
export function _resetModules(): void {
  for (const m of [..._modules.values()]) m.dispose();
  _modules.clear();
}

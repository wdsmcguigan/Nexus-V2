import type { LocalStore } from "@/storage/local";

/** Applies a module-namespaced mutation to the in-memory store (substrate Pillar 1). */
export type ModuleApply = (kind: string, payload: unknown, store: LocalStore) => void;

/** A module's reducer for the kinds in its namespace. */
export interface ModuleReducer {
  apply: ModuleApply;
}

/** Namespaces modules may not claim — reserved for the core write path. */
const RESERVED_NAMESPACES = new Set<string>(["nexus"]);

const _registry = new Map<string, ModuleReducer>();

/**
 * Register a reducer for a module namespace. Returns a disposer that
 * unregisters it. Throws on a reserved or already-registered namespace.
 */
export function registerModuleReducer(namespace: string, reducer: ModuleReducer): () => void {
  if (RESERVED_NAMESPACES.has(namespace)) {
    throw new Error(`Cannot register a reducer for reserved namespace "${namespace}"`);
  }
  if (_registry.has(namespace)) {
    throw new Error(`A reducer is already registered for namespace "${namespace}"`);
  }
  _registry.set(namespace, reducer);
  return () => {
    if (_registry.get(namespace) === reducer) _registry.delete(namespace);
  };
}

/** Returns the reducer registered for `namespace`, or `undefined`. */
export function getModuleReducer(namespace: string): ModuleReducer | undefined {
  return _registry.get(namespace);
}

/** Test-only: clear all registered reducers. */
export function _resetModuleReducers(): void {
  _registry.clear();
}

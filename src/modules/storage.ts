/**
 * Host-mediated, namespace-scoped key-value storage for modules (substrate
 * §7.4). A module never gets raw DB access; it reads/writes through this scoped
 * handle. In-memory for now; durable backing is a later concern.
 */

/** A storage handle scoped to one module namespace. */
export interface ModuleStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

const _store = new Map<string, unknown>();

function scopedKey(namespace: string, key: string): string {
  return `${namespace} ${key}`;
}

/** Returns a storage handle scoped to `namespace`. */
export function moduleStorage(namespace: string): ModuleStorage {
  return {
    get(key: string): unknown {
      return _store.get(scopedKey(namespace, key));
    },
    set(key: string, value: unknown): void {
      _store.set(scopedKey(namespace, key), value);
    },
  };
}

/** Test-only: clear all module storage. */
export function _resetModuleStorage(): void {
  _store.clear();
}

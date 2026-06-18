/**
 * Helpers for mutation-kind namespacing (substrate Pillar 1).
 *
 * Core kinds are bare identifiers (e.g. "MOVE_TO_FOLDER"). Module kinds carry a
 * reverse-DNS namespace and a separator (e.g. "com.acme.timer/START").
 * See docs/substrate-design.md §4.
 */

/** Separator between a module namespace and its kind. */
export const NAMESPACE_SEP = "/";

/** True when `kind` carries a module namespace (a separator with text before it). */
export function isNamespacedKind(kind: string): boolean {
  return kind.indexOf(NAMESPACE_SEP) > 0;
}

/**
 * Returns the module namespace for a namespaced kind, or `null` for a bare core
 * kind. Splits on the first separator: "a.b/c/d" -> "a.b".
 */
export function kindNamespace(kind: string): string | null {
  const idx = kind.indexOf(NAMESPACE_SEP);
  return idx > 0 ? kind.slice(0, idx) : null;
}

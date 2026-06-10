/**
 * Pure column-layout helpers for the table view. Extracted from TableView so the
 * saved-order merge and drag-to-reorder index math can be unit-tested.
 */

/**
 * Resolve the final column order. The saved order wins, filtered to keys that
 * still exist; any columns not yet in the saved order are appended in `allKeys`
 * order (so newly-added columns show up at the end). When nothing is saved, the
 * default `allKeys` order is used as-is.
 */
export function resolveColumnOrder(savedOrder: string[], allKeys: string[]): string[] {
  const allSet = new Set(allKeys);
  const saved = savedOrder.filter((k) => allSet.has(k));
  const unsaved = allKeys.filter((k) => !saved.includes(k));
  return saved.length > 0 ? [...saved, ...unsaved] : [...allKeys];
}

/**
 * Move `src` to the slot currently occupied by `target`, returning a new array.
 * Returns a copy unchanged when `src === target` or either key is absent.
 *
 * Mirrors TableView's DnD splice: the target index is taken before `src` is
 * removed, so dragging a column rightward lands it just after the drop target.
 */
export function reorderColumn(order: string[], src: string, target: string): string[] {
  if (src === target) return [...order];
  const next = [...order];
  const fromIdx = next.indexOf(src);
  const toIdx = next.indexOf(target);
  if (fromIdx === -1 || toIdx === -1) return [...order];
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, src);
  return next;
}

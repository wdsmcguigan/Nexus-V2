import type { LocalStore } from "@/storage/local";
import type { Link } from "@/data/types";

/** A graph neighbor: the entity on the other end of a link. */
export interface Neighbor {
  type: string;
  id: string;
  via: Link;
}

/** Outgoing links from (srcType, srcId), optionally filtered by linkType. */
export function linksFrom(
  store: LocalStore,
  srcType: string,
  srcId: string,
  linkType?: string,
): Link[] {
  const out: Link[] = [];
  for (const l of store.links.values()) {
    if (l.srcType === srcType && l.srcId === srcId && (linkType === undefined || l.linkType === linkType)) {
      out.push(l);
    }
  }
  return out;
}

/** Incoming links to (dstType, dstId), optionally filtered by linkType. */
export function linksTo(
  store: LocalStore,
  dstType: string,
  dstId: string,
  linkType?: string,
): Link[] {
  const out: Link[] = [];
  for (const l of store.links.values()) {
    if (l.dstType === dstType && l.dstId === dstId && (linkType === undefined || l.linkType === linkType)) {
      out.push(l);
    }
  }
  return out;
}

/**
 * All entities directly linked to (entType, id), in either direction. The
 * `via` link is included so callers can see the edge label. (substrate Pillar 3)
 */
export function neighbors(
  store: LocalStore,
  entType: string,
  id: string,
  linkType?: string,
): Neighbor[] {
  const result: Neighbor[] = [];
  for (const l of linksFrom(store, entType, id, linkType)) {
    result.push({ type: l.dstType, id: l.dstId, via: l });
  }
  for (const l of linksTo(store, entType, id, linkType)) {
    result.push({ type: l.srcType, id: l.srcId, via: l });
  }
  return result;
}

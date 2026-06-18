import type { Mutation } from "@/data/types";

/** A handler invoked when an applied mutation matches the subscription. */
export type BusHandler = (mutation: Mutation) => void;

interface Subscription {
  glob: string;
  handler: BusHandler;
}

/** Max reaction-cascade depth before the bus stops dispatching and logs. (substrate §5.2) */
export const MAX_REACTION_DEPTH = 8;

const _subscriptions = new Set<Subscription>();
let _depth = 0;

/**
 * True if `kind` matches `glob`: "*" (all), "ns/*" (namespace prefix), or an
 * exact kind string.
 */
export function matchesGlob(glob: string, kind: string): boolean {
  if (glob === "*") return true;
  if (glob.endsWith("/*")) return kind.startsWith(glob.slice(0, -1));
  return glob === kind;
}

/**
 * Subscribe to applied mutations whose kind matches `glob`. Returns a disposer.
 * Handlers are observers — they react by emitting their own mutations, they
 * cannot veto the triggering mutation. (substrate Pillar 2, §5)
 */
export function subscribe(glob: string, handler: BusHandler): () => void {
  const sub: Subscription = { glob, handler };
  _subscriptions.add(sub);
  return () => {
    _subscriptions.delete(sub);
  };
}

/**
 * Notify subscribers of an applied mutation. Called by the write path after a
 * *live* mutation commits (not during replay). Bounded against runaway reaction
 * cascades by MAX_REACTION_DEPTH. Not intended to be called by modules.
 */
export function emit(mutation: Mutation): void {
  if (_depth >= MAX_REACTION_DEPTH) {
    console.warn(
      `[eventBus] reaction cascade hit depth ${MAX_REACTION_DEPTH} at "${mutation.kind}" — dropping further reactions`,
    );
    return;
  }
  _depth += 1;
  try {
    for (const sub of [..._subscriptions]) {
      if (matchesGlob(sub.glob, mutation.kind)) sub.handler(mutation);
    }
  } finally {
    _depth -= 1;
  }
}

/** Test-only: clear all subscriptions and reset cascade depth. */
export function _resetEventBus(): void {
  _subscriptions.clear();
  _depth = 0;
}

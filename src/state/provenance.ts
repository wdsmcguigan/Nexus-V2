import type { MutationSource } from "@/data/types";

export interface MutationMeta {
  source?: MutationSource;
  generatedBy?: string;
}

/** Reserved key under which provenance rides inside payload_json (substrate §4.4). */
export const MUTATION_ENVELOPE_KEY = "__nexusMeta";

/** True when meta carries something worth persisting (non-default source or a generator). */
function hasMeta(meta?: MutationMeta): meta is MutationMeta {
  return !!meta && ((!!meta.source && meta.source !== "user") || !!meta.generatedBy);
}

/**
 * Wrap a payload with provenance meta — ONLY when meta is meaningful. A bare
 * "user" mutation is stored unchanged (zero overhead, zero diff for existing rows).
 */
export function wrapEnvelope(payload: unknown, meta?: MutationMeta): unknown {
  if (!hasMeta(meta)) return payload;
  return { [MUTATION_ENVELOPE_KEY]: { source: meta.source, generatedBy: meta.generatedBy }, value: payload };
}

/** Unwrap an envelope. Idempotent + a no-op for bare payloads (meta = null). */
export function unwrapEnvelope(stored: unknown): { payload: unknown; meta: MutationMeta | null } {
  if (stored && typeof stored === "object" && MUTATION_ENVELOPE_KEY in (stored as object)) {
    const env = stored as Record<string, unknown>;
    return { payload: (env as { value: unknown }).value, meta: (env[MUTATION_ENVELOPE_KEY] as MutationMeta) ?? null };
  }
  return { payload: stored, meta: null };
}

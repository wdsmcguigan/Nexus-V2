/**
 * Capability vocabulary for the module model (substrate §7.3). This module
 * PARSES and REPRESENTS capabilities; enforcement is deferred (design P4, P6).
 */

/** The known capability actions a module may request. */
export type CapabilityAction =
  | "data.read"
  | "data.write.own"
  | "mutations.emit"
  | "bus.subscribe"
  | "ui.contribute"
  | "graph.read"
  | "graph.write"
  | "net"
  | "email.send";

/** Read projection groups for an entity (substrate §7.3.1). */
export type ReadGroup =
  | "envelope"
  | "flags"
  | "preview"
  | "body"
  | "attachments"
  | "raw";

/** The sensitive read groups — never granted to third-party modules. */
export const SENSITIVE_READ_GROUPS: ReadGroup[] = ["body", "attachments", "raw"];

/** A parsed capability string. */
export interface ParsedCapability {
  action: string;
  /** Everything after the first ":", or undefined if the capability is targetless. */
  target?: string;
  /** For `data.read`, the entity type (target before "#"). */
  entType?: string;
  /** For `data.read`, the projection group (target after "#"), if present. */
  group?: string;
}

/**
 * Parse a capability string like "data.read:nexus/email.message#body" or
 * "mutations.emit:com.acme.timer/*" or "data.write.own".
 */
export function parseCapability(cap: string): ParsedCapability {
  const colon = cap.indexOf(":");
  if (colon < 0) {
    return { action: cap, target: undefined, entType: undefined, group: undefined };
  }
  const action = cap.slice(0, colon);
  const target = cap.slice(colon + 1);
  if (action === "data.read") {
    const hash = target.indexOf("#");
    if (hash >= 0) {
      return { action, target, entType: target.slice(0, hash), group: target.slice(hash + 1) };
    }
    return { action, target, entType: target, group: undefined };
  }
  return { action, target, entType: undefined, group: undefined };
}

/** True if `group` is a sensitive read group (never granted to third-party). */
export function isSensitiveGroup(group: string | undefined): boolean {
  return group !== undefined && (SENSITIVE_READ_GROUPS as string[]).includes(group);
}

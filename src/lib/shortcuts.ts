/**
 * Canonical shortcut registry for rebindable single-key shortcuts.
 * Only message-context actions are rebindable — ⌘/Ctrl combos and
 * navigation keys (J/K/↑/↓/Esc) remain fixed.
 */

export type ShortcutAction =
  | "reply"
  | "forward"
  | "archive"
  | "delete"
  | "markRead"
  | "star"
  | "snooze"
  | "compose"
  | "moveToFolder"
  | "labelPicker";

export interface ShortcutDef {
  action: ShortcutAction;
  label: string;
  defaultKey: string;
  context: "message" | "global";
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { action: "reply",        label: "Reply",           defaultKey: "r", context: "message" },
  { action: "forward",      label: "Forward",         defaultKey: "f", context: "message" },
  { action: "archive",      label: "Archive",         defaultKey: "e", context: "message" },
  { action: "delete",       label: "Delete",          defaultKey: "#", context: "message" },
  { action: "markRead",     label: "Toggle read",     defaultKey: "u", context: "message" },
  { action: "star",         label: "Toggle star",     defaultKey: "s", context: "message" },
  { action: "snooze",       label: "Snooze",          defaultKey: "h", context: "message" },
  { action: "compose",      label: "Compose",         defaultKey: "c", context: "global"  },
  { action: "moveToFolder", label: "Move to folder",  defaultKey: "v", context: "message" },
  { action: "labelPicker",  label: "Label picker",    defaultKey: "l", context: "message" },
];

/** Returns the effective key for an action, checking custom bindings first. */
export function effectiveKey(
  action: ShortcutAction,
  keyBindings: Partial<Record<ShortcutAction, string>>,
): string {
  return keyBindings[action] ?? DEFAULT_SHORTCUTS.find((s) => s.action === action)?.defaultKey ?? "";
}

/** Resolves which action is triggered by a given key, checking custom bindings first. */
export function actionForKey(
  key: string,
  keyBindings: Partial<Record<ShortcutAction, string>>,
): ShortcutAction | null {
  // Custom bindings take priority
  for (const [action, k] of Object.entries(keyBindings) as [ShortcutAction, string][]) {
    if (k.toLowerCase() === key.toLowerCase()) return action;
  }
  // Fall back to defaults — but only if no custom binding shadows it
  for (const def of DEFAULT_SHORTCUTS) {
    if (keyBindings[def.action] !== undefined) continue; // already covered by custom above
    if (def.defaultKey.toLowerCase() === key.toLowerCase()) return def.action;
  }
  return null;
}

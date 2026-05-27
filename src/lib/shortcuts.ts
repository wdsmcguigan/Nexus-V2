/**
 * Canonical shortcut registry.
 *
 * Three families:
 *  - Single-key message/global actions (rebindable) — DEFAULT_SHORTCUTS
 *  - Navigation chords ("g" then key) — NAV_SEQUENCES (handled globally)
 *  - Selection commands ("*" then key) — SELECTION_SEQUENCES (handled in the list)
 *
 * Navigation/selection sequences are fixed (not rebindable) for now.
 * J/K/↑/↓/Enter/Space/Esc/`/`/`?` remain hardcoded in their handlers.
 */

import type { SystemLabelKind } from "@/data/types";

export type ShortcutAction =
  | "reply"
  | "replyAll"
  | "forward"
  | "archive"
  | "delete"
  | "markRead"
  | "star"
  | "snooze"
  | "compose"
  | "moveToFolder"
  | "labelPicker"
  | "reportSpam"
  | "mute"
  | "selectRow"
  | "markImportant"
  | "markNotImportant"
  | "openConversation"
  | "prevMessage"
  | "nextMessage";

export interface ShortcutDef {
  action: ShortcutAction;
  label: string;
  defaultKey: string;
  context: "message" | "global";
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { action: "reply",            label: "Reply",                 defaultKey: "r", context: "message" },
  { action: "replyAll",         label: "Reply all",             defaultKey: "a", context: "message" },
  { action: "forward",          label: "Forward",               defaultKey: "f", context: "message" },
  { action: "archive",          label: "Archive",               defaultKey: "e", context: "message" },
  { action: "delete",           label: "Delete",                defaultKey: "#", context: "message" },
  { action: "reportSpam",       label: "Report spam",           defaultKey: "!", context: "message" },
  { action: "markRead",         label: "Toggle read",           defaultKey: "u", context: "message" },
  { action: "star",             label: "Toggle star",           defaultKey: "s", context: "message" },
  { action: "snooze",           label: "Snooze",                defaultKey: "b", context: "message" },
  { action: "mute",             label: "Mute conversation",     defaultKey: "m", context: "message" },
  { action: "selectRow",        label: "Select conversation",   defaultKey: "x", context: "message" },
  { action: "markImportant",    label: "Mark important",        defaultKey: "+", context: "message" },
  { action: "markNotImportant", label: "Mark not important",    defaultKey: "-", context: "message" },
  { action: "openConversation", label: "Open conversation",     defaultKey: "o", context: "message" },
  { action: "prevMessage",      label: "Previous message",      defaultKey: "p", context: "message" },
  { action: "nextMessage",      label: "Next message",          defaultKey: "n", context: "message" },
  { action: "compose",          label: "Compose",               defaultKey: "c", context: "global"  },
  { action: "moveToFolder",     label: "Move to folder",        defaultKey: "v", context: "message" },
  { action: "labelPicker",      label: "Label picker",          defaultKey: "l", context: "message" },
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

// ─── Navigation chords: "g" then <key> ───────────────────────────────────────

export type NavTarget =
  | { kind: "folder"; systemKind: SystemLabelKind }
  | { kind: "contacts" };

export interface NavSequence {
  /** The second key pressed after the "g" prefix. */
  key: string;
  label: string;
  target: NavTarget;
}

export const NAV_PREFIX = "g";

export const NAV_SEQUENCES: NavSequence[] = [
  { key: "i", label: "Go to Inbox",     target: { kind: "folder", systemKind: "inbox" } },
  { key: "s", label: "Go to Starred",   target: { kind: "folder", systemKind: "starred" } },
  { key: "t", label: "Go to Sent",      target: { kind: "folder", systemKind: "sent" } },
  { key: "d", label: "Go to Drafts",    target: { kind: "folder", systemKind: "drafts" } },
  { key: "b", label: "Go to Snoozed",   target: { kind: "folder", systemKind: "snoozed" } },
  { key: "a", label: "Go to All mail",  target: { kind: "folder", systemKind: "archive" } },
  { key: "c", label: "Go to Contacts",  target: { kind: "contacts" } },
];

export function navTargetForKey(key: string): NavTarget | null {
  return NAV_SEQUENCES.find((s) => s.key.toLowerCase() === key.toLowerCase())?.target ?? null;
}

// ─── Selection commands: "*" then <key> ──────────────────────────────────────

export type SelectionCommand = "all" | "none" | "read" | "unread" | "starred" | "unstarred";

export const SELECTION_PREFIX = "*";

export interface SelectionSequence {
  key: string;
  label: string;
  command: SelectionCommand;
}

export const SELECTION_SEQUENCES: SelectionSequence[] = [
  { key: "a", label: "Select all",         command: "all" },
  { key: "n", label: "Deselect all",       command: "none" },
  { key: "r", label: "Select read",        command: "read" },
  { key: "u", label: "Select unread",      command: "unread" },
  { key: "s", label: "Select starred",     command: "starred" },
  { key: "t", label: "Select unstarred",   command: "unstarred" },
];

export function selectionCommandForKey(key: string): SelectionCommand | null {
  return SELECTION_SEQUENCES.find((s) => s.key.toLowerCase() === key.toLowerCase())?.command ?? null;
}

// ─── Cross-handler sequence guard ─────────────────────────────────────────────
// The global navigation handler ("g" prefix) and the list handler both listen on
// window. When a "g" sequence is pending, the list handler must ignore the next
// key so e.g. the "s" in "gs" doesn't also toggle the star. This module-level
// flag is set by the global handler and read by the list handler.

let _navSequencePending = false;

export function setNavSequencePending(v: boolean): void {
  _navSequencePending = v;
}

export function isNavSequencePending(): boolean {
  return _navSequencePending;
}

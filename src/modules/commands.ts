/**
 * Host-side registry of commands contributed by modules (substrate §7.2). The
 * manifest declares command metadata (serializable); the un-serializable `run`
 * handler is bound at registration. The command palette renders these.
 */

import { isReservedShortcutKey } from "@/lib/shortcuts";

/** A command a module declares in its manifest. */
export interface ModuleCommandSpec {
  /** Module-local command id, unique within the module (e.g. "open"). */
  id: string;
  title: string;
  /** Optional single-key global shortcut (e.g. "t"). Bound by the global handler
   *  via moduleCommandForKey (fixed; not rebindable yet). Reserved core keys are ignored. */
  shortcut?: string;
  /** Optional icon name hint; the palette maps it or uses a default. */
  icon?: string;
  /** Optional palette group label; defaults to "Workspace" at render. */
  group?: string;
}

/** A registered command: its spec, owning module, key, and run handler. */
export interface RegisteredCommand {
  moduleId: string;
  spec: ModuleCommandSpec;
  /** Palette command id: `${moduleId}:${spec.id}`. */
  key: string;
  run: () => void;
}

const _commands = new Map<string, RegisteredCommand>();

/** The palette command id for a module command. */
export function moduleCommandKey(moduleId: string, commandId: string): string {
  return `${moduleId}:${commandId}`;
}

/** Register a command with its run handler. Returns a disposer. Throws on duplicate key. */
export function registerModuleCommand(
  moduleId: string,
  spec: ModuleCommandSpec,
  run: () => void,
): () => void {
  const key = moduleCommandKey(moduleId, spec.id);
  if (_commands.has(key)) {
    throw new Error(`A module command is already registered for "${key}"`);
  }
  _commands.set(key, { moduleId, spec, key, run });
  return () => {
    _commands.delete(key);
  };
}

/** All registered module commands. */
export function listModuleCommands(): RegisteredCommand[] {
  return [..._commands.values()];
}

/** The registered module command bound to `key` via its declared `spec.shortcut`,
 *  or null. Case-insensitive. Reserved (core) keys never match — core wins.
 *  First registration wins on a module-vs-module collision. */
export function moduleCommandForKey(key: string, commands: RegisteredCommand[]): RegisteredCommand | null {
  if (isReservedShortcutKey(key)) return null;
  const k = key.toLowerCase();
  return commands.find((c) => c.spec.shortcut?.toLowerCase() === k) ?? null;
}

/** Test-only: clear all registered module commands. */
export function _resetModuleCommands(): void {
  _commands.clear();
}

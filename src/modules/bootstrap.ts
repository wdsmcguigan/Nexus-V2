/**
 * Register all in-tree (core) modules at startup. Called synchronously from
 * main.tsx BEFORE React renders so dockview can resolve module panel components
 * during initial layout restore. Idempotent (guards against HMR / double eval).
 */
import { registerTasksModule } from "@/modules/tasks";
import { registerNotesModule } from "@/modules/notes";
import { registerAiModule } from "@/modules/ai";
import { registerTimekitModule } from "@/modules/timekit";

let _bootstrapped = false;

export function bootstrapModules(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;
  registerTasksModule();
  registerNotesModule();
  registerAiModule();
  registerTimekitModule();
}

/** Test-only: allow re-bootstrapping after a registry reset. */
export function _resetBootstrapForTests(): void {
  _bootstrapped = false;
}

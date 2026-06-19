/**
 * Register all in-tree (core) modules at startup. Called synchronously from
 * main.tsx BEFORE React renders so dockview can resolve module panel components
 * during initial layout restore. Idempotent (guards against HMR / double eval).
 */
import { registerTasksModule } from "@/modules/tasks";

let _bootstrapped = false;

export function bootstrapModules(): void {
  if (_bootstrapped) return;
  _bootstrapped = true;
  registerTasksModule();
}

/** Test-only: allow re-bootstrapping after a registry reset. */
export function _resetBootstrapForTests(): void {
  _bootstrapped = false;
}

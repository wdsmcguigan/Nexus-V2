/**
 * Minimal DOM + storage shims so store modules that touch `document` /
 * `localStorage` at import time can load under vitest's `node` environment
 * (the project intentionally avoids a jsdom/happy-dom dependency).
 * Import this BEFORE importing any store module.
 */

class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
  key(i: number): string | null {
    return Array.from(this.m.keys())[i] ?? null;
  }
}

const g = globalThis as unknown as Record<string, unknown>;

if (!("localStorage" in g)) {
  g.localStorage = new MemoryStorage();
}

if (!("document" in g)) {
  const classList = { toggle() {}, add() {}, remove() {} };
  g.document = { documentElement: { classList } };
}

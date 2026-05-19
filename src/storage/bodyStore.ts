/**
 * Body store — in-memory cache of email body HTML, keyed by bodyRef hash.
 *
 * In EP-4 (Tauri) this will read from disk (real .eml files parsed on demand).
 * For now it is populated at startup by the fixture generator alongside the
 * LocalStore hydration, and consulted by EmailViewerPanel to display full body.
 */

export class BodyStore {
  private _bodies = new Map<string, string>();

  set(bodyRef: string, html: string): void {
    this._bodies.set(bodyRef, html);
  }

  get(bodyRef: string): string | null {
    return this._bodies.get(bodyRef) ?? null;
  }

  has(bodyRef: string): boolean {
    return this._bodies.has(bodyRef);
  }

  size(): number {
    return this._bodies.size;
  }

  clear(): void {
    this._bodies.clear();
  }
}

export const bodyStore = new BodyStore();

/**
 * NEXUS local in-memory store — EP-0 web implementation.
 *
 * Mirrors the SQL schema from docs/architecture.md §5. Instead of SQLite we
 * maintain hand-rolled inverted indexes (Maps) so every metadata-axis filter
 * is O(1) lookup + set intersection rather than a full table scan.
 *
 * OPFS persistence: JSON snapshot read on init, debounced write on mutations.
 * The store is always synchronous for query callers; OPFS I/O is fire-and-forget.
 */

import type {
  Account,
  CustomFieldDef,
  CustomFieldValue,
  Folder,
  Label,
  Message,
  Mutation,
  Status,
  TagUsage,
  Vault,
} from "@/data/types";

// ─── Snapshot shape (OPFS) ──────────────────────────────────────────────────

interface StorageSnapshot {
  vault: Vault | null;
  accounts: Account[];
  folders: Folder[];
  labels: Label[];
  statuses: Status[];
  customFieldDefs: CustomFieldDef[];
  messages: Message[];
  tagUsage: TagUsage[];
  mutations: Mutation[];
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class LocalStore {
  // ── Primary tables ──────────────────────────────────────────────
  vault: Vault | null = null;
  accounts = new Map<string, Account>();
  folders = new Map<string, Folder>();
  labels = new Map<string, Label>();
  statuses = new Map<string, Status>();
  customFieldDefs = new Map<string, CustomFieldDef>();
  messages = new Map<string, Message>();
  tagUsage = new Map<string, TagUsage>(); // key: tag string
  mutations: Mutation[] = [];

  // ── Indexes (architecture.md §5) ────────────────────────────────

  /** messages_labels(label_id → Set<message_id>) */
  messagesByLabel = new Map<string, Set<string>>();
  /** messages_labels(message_id → Set<label_id>) */
  labelsByMessage = new Map<string, Set<string>>();

  /** messages_tags(tag → Set<message_id>) */
  messagesByTag = new Map<string, Set<string>>();

  /** (folder_id → Set<message_id>) */
  messagesByFolder = new Map<string, Set<string>>();

  /** (status_id → Set<message_id>) */
  messagesByStatus = new Map<string, Set<string>>();

  /** (priority → Set<message_id>); key is the numeric value 1–4 */
  messagesByPriority = new Map<number, Set<string>>();

  /** (thread_id → Set<message_id>) */
  messagesByThread = new Map<string, Set<string>>();

  /**
   * custom_field_values EAV indexes.
   * Outer key: field_id. Inner key: serialized value. Value: Set<message_id>.
   */
  messagesByCustomField = new Map<string, Map<string, Set<string>>>();

  // ── OPFS state ──────────────────────────────────────────────────
  private _opfsFile: FileSystemFileHandle | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 300;

  // ────────────────────────────────────────────────────────────────

  /** Seed the store from a snapshot (used by fixture migration and OPFS load). */
  hydrate(snap: StorageSnapshot): void {
    this.vault = snap.vault;
    this.accounts.clear();
    this.folders.clear();
    this.labels.clear();
    this.statuses.clear();
    this.customFieldDefs.clear();
    this.messages.clear();
    this.tagUsage.clear();
    this.mutations = [];

    // Clear indexes
    this.messagesByLabel.clear();
    this.labelsByMessage.clear();
    this.messagesByTag.clear();
    this.messagesByFolder.clear();
    this.messagesByStatus.clear();
    this.messagesByPriority.clear();
    this.messagesByThread.clear();
    this.messagesByCustomField.clear();

    for (const a of snap.accounts) this.accounts.set(a.id, a);
    for (const f of snap.folders) this.folders.set(f.id, f);
    for (const l of snap.labels) this.labels.set(l.id, l);
    for (const s of snap.statuses) this.statuses.set(s.id, s);
    for (const d of snap.customFieldDefs) this.customFieldDefs.set(d.id, d);
    for (const t of snap.tagUsage) this.tagUsage.set(t.tag, t);
    for (const m of snap.mutations) this.mutations.push(m);
    for (const msg of snap.messages) this._insertMessageIndexes(msg);
  }

  toSnapshot(): StorageSnapshot {
    return {
      vault: this.vault,
      accounts: Array.from(this.accounts.values()),
      folders: Array.from(this.folders.values()),
      labels: Array.from(this.labels.values()),
      statuses: Array.from(this.statuses.values()),
      customFieldDefs: Array.from(this.customFieldDefs.values()),
      messages: Array.from(this.messages.values()),
      tagUsage: Array.from(this.tagUsage.values()),
      mutations: this.mutations,
    };
  }

  // ── Message CRUD + index maintenance ────────────────────────────

  putMessage(msg: Message): void {
    const existing = this.messages.get(msg.id);
    if (existing) this._removeMessageIndexes(existing);
    this._insertMessageIndexes(msg);
    this._schedulePersist();
  }

  deleteMessage(id: string): void {
    const msg = this.messages.get(id);
    if (msg) {
      this._removeMessageIndexes(msg);
      this._schedulePersist();
    }
  }

  private _insertMessageIndexes(msg: Message): void {
    this.messages.set(msg.id, msg);

    // folder index
    this._setAdd(this.messagesByFolder, msg.folderId, msg.id);

    // label index (m:n)
    const msgLabels = new Set(msg.labelIds);
    this.labelsByMessage.set(msg.id, msgLabels);
    for (const lid of msg.labelIds) {
      this._setAdd(this.messagesByLabel, lid, msg.id);
    }

    // tag index (m:n)
    for (const tag of msg.tags) {
      this._setAdd(this.messagesByTag, tag, msg.id);
    }

    // status index
    if (msg.statusId) {
      this._setAdd(this.messagesByStatus, msg.statusId, msg.id);
    }

    // priority index
    if (msg.priority !== null) {
      this._setAdd(this.messagesByPriority, msg.priority, msg.id);
    }

    // thread index
    this._setAdd(this.messagesByThread, msg.threadId, msg.id);

    // custom field EAV index
    for (const [fieldId, value] of Object.entries(msg.customFields)) {
      if (value !== null && value !== undefined) {
        this._cfvIndexAdd(fieldId, value, msg.id);
      }
    }
  }

  private _removeMessageIndexes(msg: Message): void {
    this.messages.delete(msg.id);

    this._setRemove(this.messagesByFolder, msg.folderId, msg.id);

    const msgLabels = this.labelsByMessage.get(msg.id) ?? new Set();
    for (const lid of msgLabels) {
      this._setRemove(this.messagesByLabel, lid, msg.id);
    }
    this.labelsByMessage.delete(msg.id);

    for (const tag of msg.tags) {
      this._setRemove(this.messagesByTag, tag, msg.id);
    }

    if (msg.statusId) {
      this._setRemove(this.messagesByStatus, msg.statusId, msg.id);
    }

    if (msg.priority !== null) {
      this._setRemove(this.messagesByPriority, msg.priority, msg.id);
    }

    this._setRemove(this.messagesByThread, msg.threadId, msg.id);

    for (const [fieldId, value] of Object.entries(msg.customFields)) {
      if (value !== null && value !== undefined) {
        this._cfvIndexRemove(fieldId, value, msg.id);
      }
    }
  }

  // ── Label CRUD with cascade ──────────────────────────────────────

  putLabel(label: Label): void {
    this.labels.set(label.id, label);
    this._schedulePersist();
  }

  deleteLabel(id: string): void {
    this.labels.delete(id);
    // Cascade: remove label from all messages that reference it
    const affected = this.messagesByLabel.get(id);
    if (affected) {
      for (const msgId of affected) {
        const msg = this.messages.get(msgId);
        if (msg) {
          const updated: Message = {
            ...msg,
            labelIds: msg.labelIds.filter((l) => l !== id),
          };
          this._removeMessageIndexes(msg);
          this._insertMessageIndexes(updated);
        }
      }
      this.messagesByLabel.delete(id);
    }
    this._schedulePersist();
  }

  // ── Folder CRUD with cascade ─────────────────────────────────────

  putFolder(folder: Folder): void {
    this.folders.set(folder.id, folder);
    this._schedulePersist();
  }

  deleteFolder(id: string): void {
    this.folders.delete(id);
    // Cascade: messages in this folder lose their folderId reference
    // In practice the UI should move them first; here we remove the index entry.
    const affected = this.messagesByFolder.get(id);
    if (affected) {
      for (const msgId of affected) {
        const msg = this.messages.get(msgId);
        if (msg) {
          // Move to vault root sentinel — real reconciliation happens in EP-4
          const updated: Message = { ...msg, folderId: "" };
          this._removeMessageIndexes(msg);
          this._insertMessageIndexes(updated);
        }
      }
      this.messagesByFolder.delete(id);
    }
    this._schedulePersist();
  }

  // ── Status CRUD with cascade ─────────────────────────────────────

  putStatus(status: Status): void {
    this.statuses.set(status.id, status);
    this._schedulePersist();
  }

  deleteStatus(id: string): void {
    this.statuses.delete(id);
    const affected = this.messagesByStatus.get(id);
    if (affected) {
      for (const msgId of affected) {
        const msg = this.messages.get(msgId);
        if (msg) {
          const updated: Message = { ...msg, statusId: null };
          this._removeMessageIndexes(msg);
          this._insertMessageIndexes(updated);
        }
      }
      this.messagesByStatus.delete(id);
    }
    this._schedulePersist();
  }

  // ── Tag usage ────────────────────────────────────────────────────

  incrementTagUsage(vaultId: string, tag: string): void {
    const existing = this.tagUsage.get(tag);
    if (existing) {
      this.tagUsage.set(tag, {
        ...existing,
        count: existing.count + 1,
        lastUsedAt: Date.now(),
      });
    } else {
      this.tagUsage.set(tag, { vaultId, tag, count: 1, lastUsedAt: Date.now() });
    }
  }

  decrementTagUsage(tag: string): void {
    const existing = this.tagUsage.get(tag);
    if (!existing) return;
    if (existing.count <= 1) {
      this.tagUsage.delete(tag);
    } else {
      this.tagUsage.set(tag, { ...existing, count: existing.count - 1 });
    }
  }

  getTagSuggestions(prefix: string, limit = 10): TagUsage[] {
    return Array.from(this.tagUsage.values())
      .filter((t) => t.tag.toLowerCase().startsWith(prefix.toLowerCase()))
      .sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt)
      .slice(0, limit);
  }

  // ── Mutation log ────────────────────────────────────────────────

  appendMutation(mutation: Mutation): void {
    this.mutations.push(mutation);
    this._schedulePersist();
  }

  // ── OPFS persistence ─────────────────────────────────────────────

  async initOpfs(fileName = "nexus-store.json"): Promise<void> {
    if (typeof window === "undefined") return;
    try {
      const root = await navigator.storage.getDirectory();
      this._opfsFile = await root.getFileHandle(fileName, { create: true });
      // Try to load existing snapshot
      const file = await this._opfsFile.getFile();
      const text = await file.text();
      if (text.trim().length > 0) {
        const snap = JSON.parse(text) as StorageSnapshot;
        this.hydrate(snap);
      }
    } catch {
      // OPFS not available or parse error — start fresh
    }
  }

  private _schedulePersist(): void {
    if (!this._opfsFile) return;
    if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => void this._persist(), this.DEBOUNCE_MS);
  }

  private async _persist(): Promise<void> {
    if (!this._opfsFile) return;
    try {
      const writable = await this._opfsFile.createWritable();
      await writable.write(JSON.stringify(this.toSnapshot()));
      await writable.close();
    } catch {
      // Silently swallow — best-effort persistence
    }
  }

  // ── Index helpers ────────────────────────────────────────────────

  private _setAdd<K>(map: Map<K, Set<string>>, key: K, value: string): void {
    let s = map.get(key);
    if (!s) {
      s = new Set();
      map.set(key, s);
    }
    s.add(value);
  }

  private _setRemove<K>(map: Map<K, Set<string>>, key: K, value: string): void {
    const s = map.get(key);
    if (s) s.delete(value);
  }

  private _cfvSerialize(value: CustomFieldValue): string {
    return JSON.stringify(value);
  }

  private _cfvIndexAdd(fieldId: string, value: CustomFieldValue, msgId: string): void {
    let fieldMap = this.messagesByCustomField.get(fieldId);
    if (!fieldMap) {
      fieldMap = new Map();
      this.messagesByCustomField.set(fieldId, fieldMap);
    }
    const key = this._cfvSerialize(value);
    let s = fieldMap.get(key);
    if (!s) {
      s = new Set();
      fieldMap.set(key, s);
    }
    s.add(msgId);
  }

  private _cfvIndexRemove(fieldId: string, value: CustomFieldValue, msgId: string): void {
    const fieldMap = this.messagesByCustomField.get(fieldId);
    if (!fieldMap) return;
    const key = this._cfvSerialize(value);
    const s = fieldMap.get(key);
    if (s) s.delete(msgId);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const localStore = new LocalStore();

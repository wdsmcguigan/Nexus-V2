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

import { normalizeEmail } from "@/lib/email";
import type {
  Account,
  CalendarEvent,
  Calendar,
  Contact,
  ContactGroup,
  CustomFieldDef,
  CustomFieldValue,
  EventTemplate,
  Folder,
  Label,
  Link,
  Message,
  Mutation,
  Rule,
  SavedView,
  Status,
  TagUsage,
  Task,
  TaskStatus,
  Template,
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
  savedViews?: SavedView[];
  links?: Link[];
  tagUsage: TagUsage[];
  mutations: Mutation[];
  contacts?: Contact[];
  contactGroups?: ContactGroup[];
  calendarEvents?: CalendarEvent[];
  calendars?: Calendar[];
  rules?: Rule[];
  templates?: Template[];
  eventTemplates?: EventTemplate[];
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class LocalStore {
  // Subscription counter — increments on every write. Use with useSyncExternalStore.
  version = 0;
  private _listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify(): void {
    this.version += 1;
    for (const l of this._listeners) l();
  }
  // ── Primary tables ──────────────────────────────────────────────
  vault: Vault | null = null;
  accounts = new Map<string, Account>();
  folders = new Map<string, Folder>();
  labels = new Map<string, Label>();
  statuses = new Map<string, Status>();
  customFieldDefs = new Map<string, CustomFieldDef>();
  messages = new Map<string, Message>();
  tagUsage = new Map<string, TagUsage>(); // key: tag string
  savedViews = new Map<string, SavedView>();
  links = new Map<string, Link>();
  contacts = new Map<string, Contact>();
  contactGroups = new Map<string, ContactGroup>();
  /** contactId → Set<groupId> */
  groupsByContact = new Map<string, Set<string>>();
  rules = new Map<string, Rule>();
  templates = new Map<string, Template>();
  eventTemplates = new Map<string, EventTemplate>();
  calendarEvents = new Map<string, CalendarEvent>();
  calendars = new Map<string, Calendar>();
  tasks = new Map<string, Task>();
  tasksByStatus = new Map<TaskStatus, Set<string>>();
  /** email address → contactId (O(1) lookup from inspector) */
  emailIndex = new Map<string, string>();
  /** contactId → Set<messageId> (all messages where person appears in from/to/cc) */
  messagesByContact = new Map<string, Set<string>>();
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
    this.savedViews.clear();
    this.links.clear();
    this.rules.clear();
    this.templates.clear();
    this.eventTemplates.clear();
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
    this.contacts.clear();
    this.contactGroups.clear();
    this.groupsByContact.clear();
    this.emailIndex.clear();
    this.messagesByContact.clear();
    this.calendarEvents.clear();
    this.calendars.clear();
    this.tasks.clear();
    this.tasksByStatus.clear();

    for (const a of snap.accounts) this.accounts.set(a.id, a);
    for (const f of snap.folders) this.folders.set(f.id, f);
    for (const l of snap.labels) this.labels.set(l.id, l);
    for (const s of snap.statuses) this.statuses.set(s.id, s);
    for (const d of snap.customFieldDefs) this.customFieldDefs.set(d.id, d);
    for (const t of snap.tagUsage) this.tagUsage.set(t.tag, t);
    for (const m of snap.mutations) this.mutations.push(m);
    for (const msg of snap.messages) this._insertMessageIndexes(msg);
    for (const v of (snap.savedViews ?? [])) this.savedViews.set(v.id, v);
    for (const lk of (snap.links ?? [])) this.links.set(lk.id, lk);
    for (const r of (snap.rules ?? [])) this.rules.set(r.id, r);
    for (const t of (snap.templates ?? [])) this.templates.set(t.id, t);
    for (const et of (snap.eventTemplates ?? [])) this.eventTemplates.set(et.id, et);
    for (const g of (snap.contactGroups ?? [])) this.contactGroups.set(g.id, g);
    for (const e of (snap.calendarEvents ?? [])) this.calendarEvents.set(e.id, e);
    for (const c of (snap.calendars ?? [])) this.calendars.set(c.id, c);

    // Load explicit contacts from snapshot
    for (const c of (snap.contacts ?? [])) {
      this._insertContactIndexes(c);
    }

    // Auto-seed contacts from message senders not yet in emailIndex
    for (const msg of snap.messages) {
      const { name, email } = msg.fromAddr;
      if (email && !this.emailIndex.has(normalizeEmail(email))) {
        const contactId = `contact-${email.replace(/[^a-z0-9]/gi, "-")}`;
        const contact: Contact = {
          id: contactId,
          vaultId: snap.vault?.id ?? "local",
          name,
          emails: [email],
          phones: [],
          tags: [],
          socialProfiles: [],
          addresses: [],
          source: "manual",
          importance: "normal",
          createdAt: msg.receivedAt,
          updatedAt: msg.receivedAt,
        };
        this._insertContactIndexes(contact);
      }
    }

    // Build messagesByContact index (from/to/cc for all messages)
    for (const msg of snap.messages) {
      const addrs = [msg.fromAddr, ...msg.toAddrs, ...msg.ccAddrs];
      for (const addr of addrs) {
        const cid = this.emailIndex.get(normalizeEmail(addr.email));
        if (cid) this._setAdd(this.messagesByContact, cid, msg.id);
      }
    }

    this._notify();
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
      savedViews: Array.from(this.savedViews.values()),
      links: Array.from(this.links.values()),
      mutations: this.mutations,
      contacts: Array.from(this.contacts.values()),
      contactGroups: Array.from(this.contactGroups.values()),
      calendarEvents: Array.from(this.calendarEvents.values()),
      calendars: Array.from(this.calendars.values()),
    };
  }

  // ── Message CRUD + index maintenance ────────────────────────────

  putMessage(msg: Message): void {
    const existing = this.messages.get(msg.id);
    if (existing) this._removeMessageIndexes(existing);
    this._insertMessageIndexes(msg);
    this._notify();
    this._schedulePersist();
  }

  /** Merge new messages into the store without clearing existing data.
   *  Used for on-demand label loading when messages fall outside the initial hydration window. */
  mergeMessages(msgs: Message[]): void {
    let changed = false;
    for (const msg of msgs) {
      if (!this.messages.has(msg.id)) {
        this._insertMessageIndexes(msg);
        changed = true;
      }
    }
    if (changed) this._notify();
  }

  deleteMessage(id: string): void {
    const msg = this.messages.get(id);
    if (msg) {
      this._removeMessageIndexes(msg);
      this._notify();
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
    this._notify();
    this._schedulePersist();
  }

  deleteLabel(id: string): void {
    this.labels.delete(id);
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
    this._notify();
    this._schedulePersist();
  }

  // ── Folder CRUD with cascade ─────────────────────────────────────

  putFolder(folder: Folder): void {
    this.folders.set(folder.id, folder);
    this._notify();
    this._schedulePersist();
  }

  deleteFolder(id: string): void {
    this.folders.delete(id);
    const affected = this.messagesByFolder.get(id);
    if (affected) {
      for (const msgId of affected) {
        const msg = this.messages.get(msgId);
        if (msg) {
          const updated: Message = { ...msg, folderId: "" };
          this._removeMessageIndexes(msg);
          this._insertMessageIndexes(updated);
        }
      }
      this.messagesByFolder.delete(id);
    }
    this._notify();
    this._schedulePersist();
  }

  // ── Task CRUD ────────────────────────────────────────────────────

  putTask(t: Task): void {
    const prev = this.tasks.get(t.id);
    if (prev && prev.status !== t.status) this._setRemove(this.tasksByStatus, prev.status, t.id);
    this.tasks.set(t.id, t);
    this._setAdd(this.tasksByStatus, t.status, t.id);
    this._notify();
  }

  deleteTask(id: string): void {
    const prev = this.tasks.get(id);
    if (prev) this._setRemove(this.tasksByStatus, prev.status, id);
    this.tasks.delete(id);
    this._notify();
  }

  // ── Status CRUD with cascade ─────────────────────────────────────

  putStatus(status: Status): void {
    this.statuses.set(status.id, status);
    this._notify();
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
    this._notify();
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

  /**
   * Initialize OPFS persistence.
   * Returns true if a saved snapshot was loaded (subsequent sessions),
   * false if starting fresh (first visit or OPFS unavailable).
   */
  async initOpfs(fileName = "nexus-store.json"): Promise<boolean> {
    if (typeof window === "undefined") return false;
    try {
      const root = await navigator.storage.getDirectory();
      this._opfsFile = await root.getFileHandle(fileName, { create: true });
      const file = await this._opfsFile.getFile();
      const text = await file.text();
      if (text.trim().length > 0) {
        const snap = JSON.parse(text) as StorageSnapshot;
        this.hydrate(snap);
        this._notify();
        return true;
      }
    } catch {
      // OPFS not available or parse error — continue with in-memory store
    }
    return false;
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

  // ── Contact CRUD ─────────────────────────────────────────────────

  putContact(contact: Contact): void {
    const existing = this.contacts.get(contact.id);
    if (existing) {
      // Remove old email index entries
      const next = new Set(contact.emails.map(normalizeEmail));
      for (const e of existing.emails) {
        if (!next.has(normalizeEmail(e))) this.emailIndex.delete(normalizeEmail(e));
      }
    }
    this._insertContactIndexes(contact);
    this._notify();
    this._schedulePersist();
  }

  deleteContact(id: string): void {
    const c = this.contacts.get(id);
    if (!c) return;
    for (const e of c.emails) this.emailIndex.delete(normalizeEmail(e));
    this.contacts.delete(id);
    this.messagesByContact.delete(id);
    this._notify();
    this._schedulePersist();
  }

  lookupByEmail(email: string): Contact | null {
    const id = this.emailIndex.get(normalizeEmail(email));
    return id ? (this.contacts.get(id) ?? null) : null;
  }

  /** Returns the user's own account.photoUrl if the email matches one of their accounts. */
  accountPhotoUrlForEmail(email: string | undefined): string | undefined {
    if (!email) return undefined;
    const lower = email.toLowerCase();
    for (const account of this.accounts.values()) {
      if (account.email.toLowerCase() === lower && account.photoUrl) {
        return account.photoUrl;
      }
    }
    return undefined;
  }

  private _insertContactIndexes(contact: Contact): void {
    this.contacts.set(contact.id, contact);
    for (const e of contact.emails) {
      this.emailIndex.set(normalizeEmail(e), contact.id);
    }
  }

  // ── ContactGroup CRUD (EP-9) ─────────────────────────────────────

  putContactGroup(group: ContactGroup): void {
    this.contactGroups.set(group.id, group);
    this._notify();
    this._schedulePersist();
  }

  deleteContactGroup(id: string): void {
    this.contactGroups.delete(id);
    // Remove group membership entries
    for (const [contactId, groups] of this.groupsByContact) {
      groups.delete(id);
      if (groups.size === 0) this.groupsByContact.delete(contactId);
    }
    this._notify();
    this._schedulePersist();
  }

  addContactToGroup(groupId: string, contactId: string): void {
    let groups = this.groupsByContact.get(contactId);
    if (!groups) { groups = new Set(); this.groupsByContact.set(contactId, groups); }
    groups.add(groupId);
    this._notify();
    this._schedulePersist();
  }

  removeContactFromGroup(groupId: string, contactId: string): void {
    this.groupsByContact.get(contactId)?.delete(groupId);
    this._notify();
    this._schedulePersist();
  }

  getContactGroups(): ContactGroup[] {
    return Array.from(this.contactGroups.values()).sort((a, b) => a.position - b.position);
  }

  getGroupsForContact(contactId: string): string[] {
    return Array.from(this.groupsByContact.get(contactId) ?? []);
  }

  // ── Calendar event CRUD (EP-10) ─────────────────────────────────

  putCalendarEvent(event: CalendarEvent): void {
    this.calendarEvents.set(event.id, event);
    this._notify();
  }

  deleteCalendarEvent(id: string): void {
    this.calendarEvents.delete(id);
    this._notify();
  }

  getCalendarEventsInRange(startTs: number, endTs: number): CalendarEvent[] {
    return Array.from(this.calendarEvents.values())
      .filter((e) => e.endTs >= startTs && e.startTs <= endTs)
      .sort((a, b) => a.startTs - b.startTs);
  }

  // ── Calendar collection CRUD (EP-14) ────────────────────────────

  putCalendar(cal: Calendar): void {
    this.calendars.set(cal.id, cal);
    this._notify();
  }

  deleteCalendar(id: string): void {
    this.calendars.delete(id);
    this._notify();
  }

  getCalendarsSorted(): Calendar[] {
    return Array.from(this.calendars.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  // ── SavedView CRUD (EP-1) ────────────────────────────────────────

  putSavedView(view: SavedView): void {
    this.savedViews.set(view.id, view);
    this._notify();
  }

  deleteSavedView(id: string): void {
    this.savedViews.delete(id);
    this._notify();
  }

  renameSavedView(id: string, name: string): void {
    const v = this.savedViews.get(id);
    if (!v) return;
    this.savedViews.set(id, { ...v, name });
    this._notify();
  }

  /** Sorted list of all saved views by position. */
  getSavedViewsSorted(): SavedView[] {
    return Array.from(this.savedViews.values()).sort((a, b) => a.position - b.position);
  }

  // ── Link CRUD (substrate Pillar 3) ──────────────────────────────

  putLink(link: Link): void {
    this.links.set(link.id, link);
    this._notify();
  }

  deleteLink(id: string): void {
    this.links.delete(id);
    this._notify();
  }

  // ── Rule CRUD (EP-7) ─────────────────────────────────────────────

  putRule(rule: Rule): void {
    this.rules.set(rule.id, rule);
    this._notify();
    this._schedulePersist();
  }

  deleteRule(id: string): void {
    this.rules.delete(id);
    this._notify();
    this._schedulePersist();
  }

  // ── Template CRUD (EP-7) ─────────────────────────────────────────

  putTemplate(template: Template): void {
    this.templates.set(template.id, template);
    this._notify();
    this._schedulePersist();
  }

  deleteTemplate(id: string): void {
    this.templates.delete(id);
    this._notify();
    this._schedulePersist();
  }

  // ── Event Template CRUD (EP-13) ──────────────────────────────────

  putEventTemplate(tmpl: EventTemplate): void {
    this.eventTemplates.set(tmpl.id, tmpl);
    this._notify();
    this._schedulePersist();
  }

  deleteEventTemplate(id: string): void {
    this.eventTemplates.delete(id);
    this._notify();
    this._schedulePersist();
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export const localStore = new LocalStore();

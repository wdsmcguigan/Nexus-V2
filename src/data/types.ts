/**
 * NEXUS EP-0 canonical type definitions.
 * Glossary IDs are referenced in comments. See docs/glossary.md for the full
 * Is / Is NOT disambiguation for each concept.
 */

// ─── VLT — Vault ─────────────────────────────────────────────────────────────

export interface Vault {
  id: string;
  /** Resolved path on disk (desktop) or OPFS root name (web). */
  path: string;
  createdAt: number;
  /** Argon2id salt for master-key derivation — stored here for desktop; web uses subtle.crypto. */
  masterKeySalt?: string;
}

// ─── ACT — Account ───────────────────────────────────────────────────────────

export interface Account {
  id: string;
  vaultId: string;
  email: string;
  provider: "gmail" | "jmap" | "imap";
  /** Sync state reflected on NAV-ACCOUNT-DOT. */
  syncStatus: "idle" | "syncing" | "pending" | "error";
}

// ─── CNT — Contact ────────────────────────────────────────────────────────────
export interface Contact {
  id: string;
  vaultId: string;
  name: string;
  /** All known email addresses. First is primary. */
  emails: string[];
  phones: string[];
  company?: string;
  title?: string;
  website?: string;
  location?: string;
  notes?: string;
  tags: string[];
  alwaysShowImages?: boolean;
  createdAt: number;
  updatedAt: number;
}

// ─── FLD — Folder ────────────────────────────────────────────────────────────
// A real subdirectory of the vault. Each MSG lives in exactly one folder.
// Is NOT a label (LBL, metadata, many-to-many).

export interface Folder {
  id: string;
  vaultId: string;
  parentId: string | null;
  name: string;
  /** Sanitized directory name used on disk. */
  diskSlug: string;
  /** Resolved cache: "Personal/Receipts/2026". */
  diskPath: string;
  color?: number; // 1..8
  icon?: string;
  /** Only for special system folders that mirror file structure (outbox, trash-bin). */
  systemKind?: "outbox" | "trash-bin" | null;
}

// ─── LBL — Label ─────────────────────────────────────────────────────────────
// Organizational taxonomy. Many-to-many per message. Color-coded. Nestable.
// Is NOT FLD (single per message), TAG (free-form), or STA (single-value).

export type LabelKind = "system" | "user";

export type SystemLabelKind =
  | "inbox"
  | "sent"
  | "drafts"
  | "trash"
  | "archive"
  | "snoozed"
  | "starred"
  | "important";

export interface Label {
  id: string;
  vaultId: string;
  name: string;
  /** Panel-link color slot 1..8. */
  color: number;
  kind: LabelKind;
  systemKind?: SystemLabelKind;
  parentId?: string | null;
  position: number;
}

// ─── STA — Status ────────────────────────────────────────────────────────────
// Single-select workflow state. User-customizable ordered list.
// Is NOT LBL (multi-value) or PRI (urgency, not flow position).

export interface Status {
  id: string;
  vaultId: string;
  name: string;
  color: number; // 1..8
  position: number;
  isDefault?: boolean;
  isTerminal?: boolean;
}

// ─── CFD — Custom field definition ───────────────────────────────────────────
// Airtable-style user-defined typed field. Unlimited count.
// Is NOT LBL (system+user typed metadata) or TAG (untyped strings).

export type CustomFieldType =
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "datetime"
  | "url"
  | "email"
  | "boolean"
  | "select"
  | "multi-select"
  | "person";

export interface CustomFieldOption {
  id: string;
  label: string;
  color: number; // 1..8
  position: number;
}

export interface CustomFieldDef {
  id: string;
  vaultId: string;
  name: string;
  type: CustomFieldType;
  options?: CustomFieldOption[];
  description?: string;
  position: number;
  isPinned?: boolean;
  defaultValue?: unknown;
}

// ─── CFV — Custom field value ─────────────────────────────────────────────────
// A single value of a CFD for a specific message. Stored EAV-style.

export type CustomFieldValue =
  | string
  | number
  | boolean
  | Date
  | string[] // multi-select option ids
  | { type: "person"; addr: string; name?: string }
  | null;

// ─── TGU — Tag usage ─────────────────────────────────────────────────────────
// Denormalized count per TAG. Powers autocomplete in INS-TAG-BAR.

export interface TagUsage {
  vaultId: string;
  tag: string;
  count: number;
  lastUsedAt: number;
}

// ─── STR — Star style ─────────────────────────────────────────────────────────
// 12-icon Gmail-superstar set. One slot per message.
// Is NOT a boolean — replaced the old binary star.

export type StarStyle =
  | "yellow"
  | "red"
  | "orange"
  | "green"
  | "blue"
  | "purple"
  | "check-green"
  | "bang-red"
  | "question-purple"
  | "guillemet-orange"
  | "info-blue"
  | "bang-yellow";

// ─── FLG — Flag state ─────────────────────────────────────────────────────────
// Outlook-style follow-up marker with optional due date and reminder.

export interface FlagState {
  setAt: number;
  dueAt?: number;
  reminderAt?: number;
  completedAt?: number | null;
}

// ─── MSG — Message ────────────────────────────────────────────────────────────

export interface MessageFlags {
  read: boolean;
  answered: boolean;
  draft: boolean;
  /** RFC \Flagged keyword — maps to any non-null FLG. */
  flagged: boolean;
}

export interface AttachmentRef {
  name: string;
  size: number;
  type: "pdf" | "image" | "doc" | "archive" | "other";
  /** Hash for deduplication. */
  hash?: string;
  /** Provider-specific attachment ID (e.g. Gmail part ID for downloading). */
  attachmentId?: string;
  /** Provider-specific message ID needed alongside attachmentId. */
  providerMsgId?: string;
}

export interface Address {
  name: string;
  email: string;
}

export interface Message {
  id: string;
  vaultId: string;
  /** FLD — exactly one disk location. */
  folderId: string;
  threadId: string;

  providerIds: {
    gmail?: string;
    jmap?: string;
    imapUid?: number;
    /** RFC 5322 Message-ID header. */
    messageId?: string;
  };

  // ── Metadata axes ──────────────────────────────────────────────
  /** LBL — many. */
  labelIds: string[];
  /** TAG — many; free-form #hashtag strings. */
  tags: string[];
  /** STA — one (nullable). */
  statusId: string | null;
  /** PRI — one (nullable). 1=urgent … 4=low. */
  priority: 1 | 2 | 3 | 4 | null;
  /** STR — one (nullable). */
  star: StarStyle | null;
  /** FLG — one (nullable). */
  flag: FlagState | null;
  /** PIN */
  pinned: boolean;
  /** MUT — thread-wide. */
  muted: boolean;
  /** NTE — markdown string. */
  notes: string | null;
  /** CFV — keyed by CFD id. */
  customFields: Record<string, CustomFieldValue>;

  /** RFC 9051 keywords (provider-portable). */
  flags: MessageFlags;

  // ── Envelope ───────────────────────────────────────────────────
  receivedAt: number; // unix ms
  sentAt: number; // unix ms
  fromAddr: Address;
  toAddrs: Address[];
  ccAddrs: Address[];
  bccAddrs: Address[];
  subject: string;
  snippet: string;
  /** Content-hash; body lives on disk / OPFS bodies cache. */
  bodyRef: string;
  attachmentRefs: AttachmentRef[];
}

// ─── VW-SAVED — Saved view ───────────────────────────────────────────────────
// A named, persisted MetadataFilter. Surfaces in nav + palette (EP-1).

export interface SavedView {
  id: string;
  vaultId: string;
  name: string;
  filter: MetadataFilter;
  /** Lucide icon name for display in nav. */
  icon?: string;
  position: number;
  createdAt: number;
}

// ─── MUTN — Mutation ─────────────────────────────────────────────────────────
// Structured user intent. Unit of replication.
// Is NOT a direct DB write.

export type MutationKind =
  // Folder ops
  | "MOVE_TO_FOLDER"
  | "CREATE_FOLDER"
  | "RENAME_FOLDER"
  | "RECOLOR_FOLDER"
  | "DELETE_FOLDER"
  // Label ops
  | "ADD_LABEL"
  | "REMOVE_LABEL"
  | "CREATE_LABEL"
  | "RENAME_LABEL"
  | "RECOLOR_LABEL"
  | "DELETE_LABEL"
  | "REORDER_LABELS"
  // Tag ops
  | "ADD_TAG"
  | "REMOVE_TAG"
  | "RENAME_TAG_GLOBAL"
  | "DELETE_TAG_GLOBAL"
  // Status ops
  | "SET_STATUS"
  | "CLEAR_STATUS"
  | "CREATE_STATUS"
  | "RENAME_STATUS"
  | "DELETE_STATUS"
  | "REORDER_STATUSES"
  // Priority / Star / Flag / Pin / Mute / Note
  | "SET_PRIORITY"
  | "CLEAR_PRIORITY"
  | "SET_STAR"
  | "CLEAR_STAR"
  | "SET_FLAG"
  | "UPDATE_FLAG"
  | "COMPLETE_FLAG"
  | "CLEAR_FLAG"
  | "SET_PINNED"
  | "SET_MUTED"
  | "SET_NOTE"
  // Custom fields
  | "CREATE_CUSTOM_FIELD"
  | "UPDATE_CUSTOM_FIELD"
  | "DELETE_CUSTOM_FIELD"
  | "SET_CUSTOM_FIELD_VALUE"
  | "CLEAR_CUSTOM_FIELD_VALUE"
  // Message ops
  | "READ"
  | "UNREAD"
  | "ARCHIVE"
  | "TRASH"
  | "SNOOZE"
  | "DELETE_MESSAGE"
  | "SEND_MESSAGE"
  | "RECEIVE_FROM_PROVIDER"
  // Saved view ops (EP-1)
  | "SAVE_VIEW"
  | "DELETE_VIEW"
  | "RENAME_VIEW"
  // Contact ops
  | "UPSERT_CONTACT"
  | "UPDATE_CONTACT"
  | "DELETE_CONTACT";

export interface Mutation {
  id: string;
  vaultId: string;
  deviceId: string;
  /** Unix ms. */
  ts: number;
  /** Lamport logical clock. */
  lamport: number;
  kind: MutationKind;
  /** Typed payload — encrypted blob in E2EE mode (EP-5). Plain object for now. */
  payload: unknown;
}

// ─── MetadataFilter — WF-SEARCH-QUERY ────────────────────────────────────────
// Compose predicates across any combination of metadata axes.

export interface MetadataFilter {
  /** AND semantics — message must have ALL of these labels. */
  labelIds?: string[];
  /** AND semantics — message must have ALL of these tags. */
  tags?: string[];
  statusId?: string | null;
  /** priority <= maxPriority (1=urgent is highest). */
  maxPriority?: 1 | 2 | 3 | 4;
  /** priority >= minPriority. */
  minPriority?: 1 | 2 | 3 | 4;
  folderId?: string;
  threadId?: string;
  star?: StarStyle;
  pinned?: boolean;
  muted?: boolean;
  /** RFC \Seen. */
  read?: boolean;
  flagged?: boolean;
  /** Custom field equality filter. */
  customFieldValues?: Record<string, CustomFieldValue>;
  /** Free-text search on subject + snippet. Pre-FTS5 simple includes check (EP-3 adds FTS5). */
  textQuery?: string;
  /** Filter to messages where this contact appears in from/to/cc (uses messagesByContact index). */
  contactId?: string;

  // ── Sort / group ───────────────────────────────────────────────
  sortBy?: "receivedAt" | "priority" | "status" | "sender";
  sortDir?: "asc" | "desc";
  groupBy?: "status" | "priority" | "label" | null;

  // ── Pagination ─────────────────────────────────────────────────
  /** Opaque cursor returned by previous page. */
  cursor?: string;
  limit?: number;
}

export interface QueryResult {
  items: Message[];
  total: number;
  /** Wall-clock milliseconds the query took. */
  took: number;
  /** Cursor for the next page, or null if exhausted. */
  nextCursor: string | null;
}

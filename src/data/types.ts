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
  photoUrl?: string;
}

// ─── EP6 — Multi-Provider Types ──────────────────────────────────────────────

export type ImapSecurity = "tls" | "starttls" | "plain";

export interface ImapServerConfig {
  host: string;
  port: number;
  security: ImapSecurity;
  username: string;
  password: string;
}

export interface SmtpServerConfig {
  host: string;
  port: number;
  security: ImapSecurity;
  username: string;
  password: string;
}

export interface ImapAccountInput {
  email: string;
  displayName?: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: ImapSecurity;
  imapUsername: string;
  imapPassword: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: ImapSecurity;
}

export interface DiscoveryResult {
  imap: ImapServerConfig | null;
  smtp: SmtpServerConfig | null;
  /** "known" | "discovered" | "guessed" */
  confidence: string;
  requiresAppPassword: boolean;
  oauthUrl: string | null;
}

export interface SyncStats {
  fetched: number;
  inserted: number;
  updated: number;
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
  photoUrl?: string;
  alwaysShowImages?: boolean;
  birthday?: string; // ISO "YYYY-MM-DD" or "--MM-DD" (no year)
  socialProfiles: Array<{ platform: string; username: string }>;
  addresses: Array<{ label: string; street: string; city: string; state: string; country: string; zip: string }>;
  source: "google" | "apple" | "manual";
  externalId?: string;
  importance: "vip" | "normal";
  createdAt: number;
  updatedAt: number;
}

export interface ContactGroup {
  id: string;
  vaultId: string;
  name: string;
  color?: string;
  position: number;
  createdAt: number;
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

// ─── TASK — org.nexus.tasks/task entity ──────────────────────────────────────
/** VTODO-aligned task workflow state (RFC 5545). UI labels the first three
 *  "To do" / "Doing" / "Done"; "cancelled" is reserved for a later step. */
export type TaskStatus = "needs-action" | "in-process" | "completed" | "cancelled";

export interface Task {
  id: string;
  vaultId: string;
  title: string;
  status: TaskStatus;
  dueAt: number | null;
  notes: string | null;
  priority: 1 | 2 | 3 | 4 | null;
  assignee: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
}

// ─── NOTE — org.nexus.notes/note entity ──────────────────────────────────────

export interface Note {
  id: string;
  vaultId: string;
  title: string;
  body: string;        // TipTap HTML
  createdAt: number;
  updatedAt: number;   // drives list sort; stamped at record-time
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
  type: "pdf" | "image" | "doc" | "archive" | "calendar" | "other";
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
  /** Parsed List-Unsubscribe header JSON: { link?: string; post?: string } */
  listUnsubscribeJson?: string;
  /** Raw ICS text from a text/calendar MIME part or .ics attachment. */
  icalData?: string;
}

// ─── CAL — Calendar events ───────────────────────────────────────────────────

export interface CalendarAttendee {
  email: string;
  name?: string;
  responseStatus: "accepted" | "declined" | "tentative" | "needsAction";
  self?: boolean;
  organizer?: boolean;
}

export interface CalendarAttachment {
  fileUrl: string;
  title: string;
  mimeType: string;
  iconLink?: string;
  fileId?: string;
}

export interface CalendarReminder {
  method: "email" | "popup";
  minutes: number;
}

export interface CalendarEvent {
  id: string;
  vaultId: string;
  accountId: string;
  calendarId: string;
  externalId?: string;
  title: string;
  description?: string;
  location?: string;
  startTs: number;
  endTs: number;
  allDay: boolean;
  rrule?: string;
  status: "confirmed" | "tentative" | "cancelled";
  organizerEmail?: string;
  attendees: CalendarAttendee[];
  htmlLink?: string;
  notes?: string;
  sourceMessageId?: string;
  // EP12 — full Google Calendar API field capture
  conferenceUrl?: string;
  colorId?: string;
  iCalUID?: string;
  recurringEventId?: string;
  creatorEmail?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  transparency?: "opaque" | "transparent";
  reminders?: CalendarReminder[];
  attachments?: CalendarAttachment[];
  // EP14 — standalone calendar
  /** Local calendar this event belongs to (FK to Calendar.id). */
  calendarLocalId?: string;
  /** IANA timezone of the start/end wall-clock time. Undefined = floating (all-day). */
  startTzid?: string;
  endTzid?: string;
  /** For an expanded recurring instance: the master event's id. */
  masterId?: string;
  /** For an expanded recurring instance: the occurrence's original start (epoch ms). */
  occurrenceStart?: number;
  createdAt: number;
  updatedAt: number;
}

// ─── CAL — Calendar (EP-14) ──────────────────────────────────────────────────
// A calendar collection. May be purely local (provider="local", no account) or
// backed by a remote provider. Events bind to a calendar regardless of account.

export interface Calendar {
  id: string;
  vaultId: string;
  /** Null/undefined for a local-only calendar. */
  accountId?: string;
  /** Provider calendar id (e.g. Google "primary"); undefined for local. */
  externalId?: string;
  name: string;
  color?: string;
  enabled: boolean;
  readOnly: boolean;
  provider: "local" | "google" | "caldav";
  createdAt: number;
  updatedAt: number;
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

// ─── LNK — Link (substrate Pillar 3) ─────────────────────────────────────────
// A typed edge between two entities. Either endpoint may be a core entity
// (e.g. "nexus/email.message") or a module entity (e.g. "org.nexus.tasks/task").

export interface Link {
  id: string;
  vaultId: string;
  /** ENT type of the source, e.g. "nexus/email.message". */
  srcType: string;
  srcId: string;
  /** Edge label, e.g. "derived-from", "tracks", "mentions". */
  linkType: string;
  /** ENT type of the destination. */
  dstType: string;
  dstId: string;
  /** Optional edge metadata. */
  meta?: unknown;
  /** Unix ms. */
  createdAt: number;
}

// ─── MUTN — Mutation ─────────────────────────────────────────────────────────
// Structured user intent. Unit of replication.
// Is NOT a direct DB write.

export type CoreMutationKind =
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
  | "REORDER_CUSTOM_FIELD_DEFS"
  | "REORDER_CUSTOM_FIELD_OPTIONS"
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
  // Link / relations graph ops (substrate Pillar 3)
  | "CREATE_LINK"
  | "DELETE_LINK"
  // Contact ops
  | "UPSERT_CONTACT"
  | "UPDATE_CONTACT"
  | "DELETE_CONTACT"
  | "CREATE_CONTACT_GROUP"
  | "UPDATE_CONTACT_GROUP"
  | "DELETE_CONTACT_GROUP"
  | "ADD_CONTACT_TO_GROUP"
  | "REMOVE_CONTACT_FROM_GROUP"
  // Rule ops (EP-7)
  | "CREATE_RULE"
  | "UPDATE_RULE"
  | "DELETE_RULE"
  | "REORDER_RULES"
  // Template ops (EP-7)
  | "CREATE_TEMPLATE"
  | "UPDATE_TEMPLATE"
  | "DELETE_TEMPLATE"
  // Calendar ops (EP-11)
  | "UPSERT_CALENDAR_EVENT"
  | "DELETE_CALENDAR_EVENT"
  | "UPDATE_CALENDAR_EVENT_NOTES"
  | "UPDATE_CALENDAR_EVENT"
  // Event template ops (EP-13)
  | "SAVE_EVENT_TEMPLATE"
  | "DELETE_EVENT_TEMPLATE"
  // Calendar collection + recurrence ops (EP-14)
  | "UPSERT_CALENDAR"
  | "UPDATE_CALENDAR"
  | "DELETE_CALENDAR"
  | "EDIT_EVENT_OCCURRENCE"
  | "EDIT_EVENT_SERIES";

/**
 * A module-contributed mutation kind: a namespace, a "/" separator, and a kind,
 * e.g. "com.acme.timer/START". See docs/substrate-design.md §4.
 */
export type ModuleMutationKind = `${string}/${string}`;

/** Any mutation kind — a core kind or a module-namespaced one. */
export type MutationKind = CoreMutationKind | ModuleMutationKind;

export type MutationSource = "user" | "ai" | "rule" | "module";

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
  /** Provenance (substrate §4.4). Absent ⇒ "user". Carried in payload_json, not a column. */
  source?: MutationSource;
  /** Optional generator id (e.g. model id "claude-…" or module id). */
  generatedBy?: string;
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

// ─── EP-7: Rules ─────────────────────────────────────────────────────────────

export type RuleConditionField = "from" | "to" | "subject" | "has_attachment" | "tag" | "label";
export type RuleConditionOp = "contains" | "equals" | "starts_with" | "not_contains";

export interface RuleCondition {
  field: RuleConditionField;
  op: RuleConditionOp;
  value: string;
}

export type RuleActionKind =
  | "ADD_LABEL"
  | "REMOVE_LABEL"
  | "SET_STATUS"
  | "SET_PRIORITY"
  | "ADD_TAG"
  | "ARCHIVE"
  | "TRASH"
  | "MARK_READ"
  | "STAR";

export interface RuleAction {
  kind: RuleActionKind;
  value?: string;
}

export interface Rule {
  id: string;
  vaultId: string;
  name: string;
  conditions: RuleCondition[];
  conditionLogic: "AND" | "OR";
  actions: RuleAction[];
  enabled: boolean;
  position: number;
}

// ─── EP-7: Templates ─────────────────────────────────────────────────────────

export interface Template {
  id: string;
  vaultId: string;
  name: string;
  subject: string;
  bodyHtml: string;
  createdAt: number;
}

// ─── EP-13: Calendar Event Templates ─────────────────────────────────────────

export interface EventTemplate {
  id: string;
  vaultId: string;
  name: string;
  title: string;
  description?: string;
  location?: string;
  /** Duration in minutes — auto-computes endTs when creating from template. */
  durationMinutes: number;
  defaultAttendees: string[];
  createdAt: number;
}

// ─── Panel Color Identity ────────────────────────────────────────────────────

/**
 * Identifies a Nexus dockview module type. Values MUST match the keys in
 * DV_COMPONENTS in src/components/Workspace.tsx — if you add a new module,
 * add it here too and add a default in DEFAULT_MODULE_COLORS in
 * src/lib/panelColors.ts.
 */
export type ModuleKey =
  | "nav"
  | "list"
  | "viewer"
  | "inspector"
  | "contacts"
  | "calendar"
  | "settings";

export interface PanelColorPrefs {
  /**
   * Per-module color override. Value is either a token reference like
   * "link-4" (resolves to var(--color-link-4)) or a hex string like
   * "#aabbcc". Missing keys fall through to the system default.
   */
  colors: Partial<Record<ModuleKey, string>>;
  /** Body-tint intensity. L2 = selected row + divider only. L3 = adds wash + hover. */
  bodyTintLevel: "L2" | "L3";
}

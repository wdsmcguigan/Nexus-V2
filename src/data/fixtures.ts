/**
 * EP-0 fixture data — seeds the local store with the full metadata-axis schema.
 *
 * Exports two layers:
 *   1. EP-0 typed seed data (Folder, Label, Status, Message, etc.) → fed into LocalStore
 *   2. Backward-compat shim (old Email / Folder types) → keeps existing UI compiling
 *      while Phase 0c–0e migrate components to Message directly.
 *
 * System label IDs intentionally match the old "folder" IDs ("inbox", "starred", …)
 * so that `workspace.selectedFolderId = "inbox"` continues to select the Inbox label.
 */

import { pickPanelLink, type PanelLink } from "@/design-system/tokens";
import { localStore } from "@/storage/local";
import { bodyStore } from "@/storage/bodyStore";
import { ftsIndex } from "@/storage/fts";
import { queryMessages } from "@/storage/query";
import type {
  Account as EPAccount,
  Folder as EPFolder,
  Label as EPLabel,
  Message,
  Status,
  CustomFieldDef,
  AttachmentRef,
  MessageFlags,
  Address as EPAddress,
} from "@/data/types";

// ─── backward-compat types (still used by UI in Phase 0b) ───────────────────

export interface Address {
  name: string;
  email: string;
  colorSeed: PanelLink;
}

export interface Label {
  id: string;
  name: string;
  color: PanelLink;
}

export interface Attachment {
  name: string;
  size: number;
  type: "pdf" | "image" | "doc" | "archive" | "other";
}

export interface Email {
  id: string;
  threadId: string;
  from: Address;
  to: Address[];
  cc?: Address[];
  subject: string;
  snippet: string;
  body: string;
  receivedAt: Date;
  read: boolean;
  starred: boolean;
  labels: Label[];
  attachments: Attachment[];
  folderId: string;
}

export interface Folder {
  id: string;
  name: string;
  icon: string;
  count: number;
  unreadCount: number;
  system?: boolean;
}

export interface Account {
  id: string;
  email: string;
  syncStatus: "idle" | "syncing" | "error";
  unread: number;
}

// ─── EP-0 seed data IDs ──────────────────────────────────────────────────────

const VAULT_ID = "local";

// FLD ids — physical disk folders
const F = {
  inbox: "fld-inbox-physical",
  personal: "fld-personal",
  receipts: "fld-personal-receipts",
  receipts26: "fld-personal-receipts-2026",
  clients: "fld-clients",
  projects: "fld-projects",
  newsletters: "fld-newsletters",
} as const;

// LBL ids — system labels match old folder IDs so nav still works unchanged
const L = {
  inbox: "inbox",       // system
  starred: "starred",   // system
  drafts: "drafts",     // system
  sent: "sent",         // system
  snoozed: "snoozed",   // system
  archive: "archive",   // system
  spam: "spam",         // system
  trash: "trash",       // system
  work: "lbl-work",
  personal: "lbl-personal",
  followup: "lbl-followup",
  newsletter: "lbl-newsletter",
  receipts: "lbl-receipts",
  travel: "lbl-travel",
} as const;

// STA ids
const S = {
  triage: "sta-triage",
  reading: "sta-reading",
  awaiting: "sta-awaiting",
  action: "sta-action",
  done: "sta-done",
} as const;

// CFD ids
const CFD = {
  project: "cfd-project",
  dealStage: "cfd-deal-stage",
  notesUrl: "cfd-notes-url",
} as const;

// ACT ids
const A_IDS = { main: "act-main", gmail: "act-gmail" } as const;

// ─── Seed definitions ─────────────────────────────────────────────────────────

const seedFolders: EPFolder[] = [
  {
    id: F.inbox,
    vaultId: VAULT_ID,
    parentId: null,
    name: "Inbox items",
    diskSlug: "Inbox-items",
    diskPath: "Inbox-items",
  },
  {
    id: F.personal,
    vaultId: VAULT_ID,
    parentId: null,
    name: "Personal",
    diskSlug: "Personal",
    diskPath: "Personal",
  },
  {
    id: F.receipts,
    vaultId: VAULT_ID,
    parentId: F.personal,
    name: "Receipts",
    diskSlug: "Receipts",
    diskPath: "Personal/Receipts",
  },
  {
    id: F.receipts26,
    vaultId: VAULT_ID,
    parentId: F.receipts,
    name: "2026",
    diskSlug: "2026",
    diskPath: "Personal/Receipts/2026",
  },
  {
    id: F.clients,
    vaultId: VAULT_ID,
    parentId: null,
    name: "Clients",
    diskSlug: "Clients",
    diskPath: "Clients",
  },
  {
    id: F.projects,
    vaultId: VAULT_ID,
    parentId: null,
    name: "Projects",
    diskSlug: "Projects",
    diskPath: "Projects",
  },
  {
    id: F.newsletters,
    vaultId: VAULT_ID,
    parentId: null,
    name: "Newsletters",
    diskSlug: "Newsletters",
    diskPath: "Newsletters",
  },
];

const seedLabels: EPLabel[] = [
  { id: L.inbox, vaultId: VAULT_ID, name: "Inbox", color: 5, kind: "system", systemKind: "inbox", position: 0 },
  { id: L.starred, vaultId: VAULT_ID, name: "Starred", color: 2, kind: "system", systemKind: "starred", position: 1 },
  { id: L.drafts, vaultId: VAULT_ID, name: "Drafts", color: 8, kind: "system", systemKind: "drafts", position: 2 },
  { id: L.sent, vaultId: VAULT_ID, name: "Sent", color: 1, kind: "system", systemKind: "sent", position: 3 },
  { id: L.snoozed, vaultId: VAULT_ID, name: "Snoozed", color: 3, kind: "system", systemKind: "snoozed", position: 4 },
  { id: L.archive, vaultId: VAULT_ID, name: "Archive", color: 7, kind: "system", systemKind: "archive", position: 5 },
  { id: L.spam, vaultId: VAULT_ID, name: "Spam", color: 4, kind: "system", systemKind: "important", position: 6 },
  { id: L.trash, vaultId: VAULT_ID, name: "Trash", color: 6, kind: "system", systemKind: "trash", position: 7 },
  { id: L.work, vaultId: VAULT_ID, name: "Work", color: 5, kind: "user", position: 0 },
  { id: L.personal, vaultId: VAULT_ID, name: "Personal", color: 6, kind: "user", position: 1 },
  { id: L.followup, vaultId: VAULT_ID, name: "Follow-up", color: 2, kind: "user", parentId: L.work, position: 2 },
  { id: L.newsletter, vaultId: VAULT_ID, name: "Newsletter", color: 8, kind: "user", position: 3 },
  { id: L.receipts, vaultId: VAULT_ID, name: "Receipts", color: 3, kind: "user", position: 4 },
  { id: L.travel, vaultId: VAULT_ID, name: "Travel", color: 4, kind: "user", position: 5 },
];

const seedStatuses: Status[] = [
  { id: S.triage, vaultId: VAULT_ID, name: "Triage", color: 1, position: 0, isDefault: true },
  { id: S.reading, vaultId: VAULT_ID, name: "Reading", color: 2, position: 1 },
  { id: S.awaiting, vaultId: VAULT_ID, name: "Awaiting Reply", color: 3, position: 2 },
  { id: S.action, vaultId: VAULT_ID, name: "Action", color: 4, position: 3 },
  { id: S.done, vaultId: VAULT_ID, name: "Done", color: 5, position: 4, isTerminal: true },
];

const seedCustomFieldDefs: CustomFieldDef[] = [
  {
    id: CFD.project,
    vaultId: VAULT_ID,
    name: "Project",
    type: "select",
    options: [
      { id: "cfd-proj-opt-nexus", label: "Nexus", color: 5, position: 0 },
      { id: "cfd-proj-opt-acme", label: "Acme", color: 2, position: 1 },
      { id: "cfd-proj-opt-horizon", label: "Horizon", color: 4, position: 2 },
    ],
    position: 0,
    isPinned: true,
  },
  {
    id: CFD.dealStage,
    vaultId: VAULT_ID,
    name: "Deal Stage",
    type: "select",
    options: [
      { id: "ds-prospect", label: "Prospect", color: 8, position: 0 },
      { id: "ds-negotiating", label: "Negotiating", color: 3, position: 1 },
      { id: "ds-closed", label: "Closed", color: 5, position: 2 },
    ],
    position: 1,
  },
  {
    id: CFD.notesUrl,
    vaultId: VAULT_ID,
    name: "Notes URL",
    type: "url",
    position: 2,
  },
];

const seedAccounts: EPAccount[] = [
  { id: A_IDS.main, vaultId: VAULT_ID, email: "will@nexus.app", provider: "jmap", syncStatus: "idle" },
  { id: A_IDS.gmail, vaultId: VAULT_ID, email: "will.mcguigan@gmail.com", provider: "gmail", syncStatus: "syncing" },
];

// ─── Message generator ───────────────────────────────────────────────────────

const now = Date.now();
function ago(minutes: number): number {
  return now - minutes * 60_000;
}

function epAddr(name: string, email: string): EPAddress {
  return { name, email };
}

const senders: EPAddress[] = [
  epAddr("Alice Chen", "alice@axiomlabs.io"),
  epAddr("Bob Marcus", "bob.marcus@northroot.com"),
  epAddr("Priya Subramanian", "priya@palomar.dev"),
  epAddr("Diego Hernández", "diego.h@cobaltworks.io"),
  epAddr("Yuki Tanaka", "yuki@brightpath.studio"),
  epAddr("GitHub", "noreply@github.com"),
  epAddr("Stripe", "receipts@stripe.com"),
  epAddr("Linear", "notifications@linear.app"),
  epAddr("Mae Patel", "mae@harborline.co"),
  epAddr("Henry Vasquez", "henry@stagepoint.studio"),
  epAddr("Cassidy Yong", "cy@meridian.fund"),
  epAddr("Rohit Sharma", "rohit.sharma@northpath.dev"),
  epAddr("AWS Billing", "no-reply-aws@amazon.com"),
  epAddr("Vercel", "support@vercel.com"),
  epAddr("Substack — Stratechery", "stratechery@substack.com"),
];

const subjects = [
  "Q2 review notes — please skim before Tuesday",
  "Re: Ship date for the new dock-view milestone",
  "Invoice #00482 — Sept services",
  "Your build #4218 succeeded",
  "Welcome to the team — onboarding doc",
  "Weekly digest: 14 new mentions",
  "Re: Re: Customer call follow-up",
  "Action required: 2FA recovery codes",
  "Pull request #312 was merged",
  "Receipt from Vercel — $20.00",
  "Stratechery Daily Update — May 8, 2026",
  "Quick question about the panel taxonomy",
  "Your AWS bill is ready (April 2026)",
  "Demo this Thursday? — proposed times",
  "[Linear] DESIGN-118 assigned to you",
  "Project update — week of May 5",
  "Re: Hiring loop debrief — eng candidate",
  "Reminder: contract renewal due May 15",
  "Lunch tomorrow?",
  "Your trip to Tokyo — 3 days away",
  "Re: Soundminer reference — sending screenshots",
  "Outage summary and post-mortem (draft)",
  "🎉 Your onboarding is complete",
  "Notes from the offsite — actions",
  "Heads up: vendor migration window Friday",
];

const snippets = [
  "Hey — wanted to share a few updates from the planning session. The big item is that we shifted the timeline to mid-June, and the team is comfortable with that pace as long as we lock the design",
  "I've gone through the spec and have a couple of questions about the panel-link palette behavior when a user has more than 8 paired panels. Do they recycle, or do we surface a warning",
  "Please find attached the September invoice for services rendered. Net-30 terms apply. Wire details haven't changed — let me know if you need them resent",
  "Build #4218 completed successfully on `main` in 4m 12s. Tests: 1,247 passed. No regressions detected. Artifact published to the staging registry",
  "Welcome aboard — really excited to have you on the team. Below is the onboarding doc with everything you need for week one. Reach out anytime",
  "Your weekly digest is ready. There were 14 mentions of you across 6 conversations this week. Top thread: 'Q2 review notes' (5 replies)",
  "Got it — sounds great. I'll put together a call summary by EOD and circulate to the wider group. Let me know if you want anything else covered",
  "We've detected a sign-in to your account from a new device. If this was you, you can ignore this email. If not, please review your account security",
  "Pull request #312 (`feat(panels): contextual ghosting`) was merged into `main` by alice-chen. 47 files changed, +2,103 −418",
  "Thanks for your payment of $20.00 for Vercel Pro — May 2026. This receipt is for your records. Your next billing date is June 8, 2026",
  "Today's update covers three threads: (1) the platform shifts at Apple, (2) why subscription fatigue is real, (3) what it means for media",
  "Quick one — when you have a sec, can you walk me through the rationale for splitting Stage and Inspector into separate types? I have the build plan",
  "Your AWS bill for April 2026 is now available. Total: $1,247.32. The largest line items were EC2 ($512.04) and S3 ($203.18)",
  "Want to do a quick demo Thursday afternoon? I have 2pm, 3:30pm, or 4pm open. Should take 30 minutes — I'll walk through the prototype",
  "DESIGN-118 'Audit Contextual Ghosting against keyboard navigation' was assigned to you by Priya. Due in 5 days",
  "Quick weekly summary — shipped: panel taxonomy refactor, density modes. In flight: command palette, Tiptap editor. Blocked on: design tokens review",
  "Quick recap from the debrief: strong on systems thinking, decent on collaboration, light on Tauri specifics but very willing to learn. Net: lean yes, with conditions",
  "Friendly reminder that your annual contract renews on May 15. The new rate is $1,200 (up from $1,000) — let me know if you want to discuss",
  "Hey — want to grab lunch tomorrow at the place near your office? Around noon? Last time we tried Thai but I'm easy",
  "Your trip to Tokyo is in 3 days. We've prepared a summary of your itinerary, hotel details, and ground transport. Have a great trip",
  "Sending the Soundminer screenshots you asked about — the metadata column treatment is what I want to anchor on. Notice how the right side stays flush",
  "The post-mortem draft is attached. Headlines: 22-minute outage, root cause was a stale DNS record after the regional failover. Action items inside",
  "Your onboarding is now complete — you've finished all 12 steps. Here's a recap of what we covered and where to go next for advanced topics",
  "From yesterday's offsite, here are the three commitments we made: (1) ship v1.0 by July 15, (2) hire two more designers, (3) consolidate tooling",
  "Heads up — we're migrating away from the old vendor on Friday between 10pm and 2am. Expect a brief read-only window. Sending follow-ups daily",
];

type LabelSet = string[];

const labelOptions: LabelSet[] = [
  [L.inbox, L.work],
  [L.inbox, L.work],
  [L.inbox, L.personal],
  [L.inbox, L.followup, L.work],
  [L.inbox, L.newsletter],
  [L.inbox, L.receipts],
  [L.inbox, L.travel, L.personal],
  [L.inbox],
  [L.inbox, L.work, L.followup],
  [L.inbox, L.newsletter, L.followup],
];

function rand<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length] as T;
}

function generateMessages(): Message[] {
  const out: Message[] = [];
  let threadCount = 0;

  for (let i = 0; i < 60; i++) {
    const sender = rand(senders, i);
    const subject = rand(subjects, i);
    const snippet = rand(snippets, i);
    const minutesAgo = i * 27 + (i % 5) * 13;
    const isThread = i % 7 === 3;
    const threadId = isThread ? `thread-${threadCount}` : `thread-${++threadCount}`;
    if (isThread) threadCount++;

    const isSnoozed = i % 17 === 0;
    const labelSet: string[] = isSnoozed
      ? [L.snoozed]
      : (rand(labelOptions, i) as string[]);
    const hasAttachment = i % 6 === 0;
    const hasStatus = i % 5 === 0;
    const hasPriority = i % 4 === 0;
    const hasStar = i % 9 === 1;
    const hasTags = i % 8 === 2;
    const isPinned = i === 3;
    const isMuted = i === 11;
    const hasNote = i === 7;
    const hasCFV = i === 2 || i === 5;

    const flags: MessageFlags = {
      read: i > 4 && i % 3 !== 0,
      answered: i % 15 === 0,
      draft: false,
      flagged: i % 13 === 0,
    };

    const attachmentRefs: AttachmentRef[] = hasAttachment
      ? [
          {
            name: i % 12 === 0 ? "Q2-deck.pdf" : "screenshot.png",
            size: i % 12 === 0 ? 4_212_000 : 482_000,
            type: i % 12 === 0 ? "pdf" : "image",
          },
        ]
      : [];

    const statuses = [S.triage, S.reading, S.awaiting, S.action, S.done];
    const priorities: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
    const stars = [
      "yellow", "red", "orange", "green", "blue",
      "check-green", "bang-red", "question-purple",
    ] as const;

    out.push({
      id: `email-${i.toString().padStart(3, "0")}`,
      vaultId: VAULT_ID,
      folderId: F.inbox,
      threadId,
      providerIds: { messageId: `<msg-${i}@nexus.app>` },
      labelIds: labelSet,
      tags: hasTags ? [`project-${i % 4}`, "follow-up"] : [],
      statusId: hasStatus ? (rand(statuses, i) ?? null) : null,
      priority: hasPriority ? (rand(priorities, i) ?? null) : null,
      star: hasStar ? (rand(stars, i) ?? null) : null,
      flag: flags.flagged ? { setAt: ago(minutesAgo + 5) } : null,
      pinned: isPinned,
      muted: isMuted,
      notes: hasNote ? "Check this one carefully before replying." : null,
      customFields: hasCFV
        ? { [CFD.project]: i === 2 ? "cfd-proj-opt-nexus" : "cfd-proj-opt-acme" }
        : {},
      flags,
      receivedAt: ago(minutesAgo),
      sentAt: ago(minutesAgo + 1),
      fromAddr: sender,
      toAddrs: [epAddr("Will McGuigan", "will@nexus.app")],
      ccAddrs: i % 11 === 0 ? [epAddr("Mae Patel", "mae@harborline.co")] : [],
      bccAddrs: [],
      subject,
      snippet,
      bodyRef: `hash-${i}`,
      attachmentRefs,
    });
  }

  return out;
}

// ─── 100k synthetic message generator (dev-only, Gate 0g benchmark) ──────────

export function generateSyntheticMessages(count: number): Message[] {
  const statuses = Object.values(S);
  const labelGroups = [L.inbox, L.work, L.personal, L.newsletter, L.receipts, L.travel];
  const tags = ["urgent", "follow-up", "review", "blocked", "done"];
  const priorities: Array<1 | 2 | 3 | 4> = [1, 2, 3, 4];
  const out: Message[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `synth-${i}`,
      vaultId: VAULT_ID,
      folderId: F.inbox,
      threadId: `synth-thread-${Math.floor(i / 3)}`,
      providerIds: {},
      labelIds: [labelGroups[i % labelGroups.length]!],
      tags: i % 7 === 0 ? [tags[i % tags.length]!] : [],
      statusId: i % 5 === 0 ? (statuses[i % statuses.length] ?? null) : null,
      priority: i % 4 === 0 ? (priorities[i % priorities.length] ?? null) : null,
      star: null,
      flag: null,
      pinned: false,
      muted: false,
      notes: null,
      customFields: i % 11 === 0 ? { [CFD.project]: "cfd-proj-opt-acme" } : {},
      flags: { read: i % 2 === 0, answered: false, draft: false, flagged: false },
      receivedAt: now - i * 60_000,
      sentAt: now - i * 60_000 - 30_000,
      fromAddr: { name: `Sender ${i}`, email: `sender${i}@example.com` },
      toAddrs: [{ name: "Will", email: "will@nexus.app" }],
      ccAddrs: [],
      bccAddrs: [],
      subject: `Synthetic message ${i}`,
      snippet: `Snippet for synthetic message ${i} with some text`,
      bodyRef: `synth-hash-${i}`,
      attachmentRefs: [],
    });
  }
  return out;
}

// ─── Body generator (EP-3) ───────────────────────────────────────────────────

const bodyParagraphs: string[][] = [
  // 0 — Q2 review notes
  ["Hey — wanted to share a few updates from the planning session. The big item is that we shifted the timeline to mid-June, and the team is comfortable with that pace as long as we lock the design by Friday.", "Key decisions from Tuesday: panel taxonomy stays as-is (Stage + Inspector + Nav + List), density modes ship in the next sprint, and the command palette gate moves to EP-0 final.", "I've attached the full notes doc but wanted to flag the three action items that landed on us: (1) finalize the color token naming convention, (2) confirm whether FTS goes in EP-3 or EP-4, and (3) close the OPFS strategy.", "Let me know if any of these are mis-attributed — happy to adjust. Ping me if you want to sync before Tuesday."],
  // 1 — dock-view milestone
  ["I've gone through the spec and have a couple of questions about the panel-link palette behavior when a user has more than 8 paired panels. Do they recycle, or do we surface a warning?", "Also noticed that the resize handle in the current build loses its hover state after a double-click. This might be a dockview event propagation issue — I'll dig in today.", "For the milestone itself, I think we're close. The remaining blockers are: (a) keyboard focus order in the inspector, (b) scroll preservation on panel switch, and (c) the ghosting animation on close.", "Will create Linear tickets for each — should be able to get them all done before the Thursday cut."],
  // 2 — Invoice
  ["Please find attached the September invoice for services rendered. Net-30 terms apply. Wire details haven't changed — let me know if you need them resent.", "Line items: design consultation (18h at $180/hr = $3,240), prototyping sessions (6h at $200/hr = $1,200), and a one-time project setup fee of $500.", "Total due: $4,940. Bank details on file; remittance to the usual account. PO number: NXS-2024-09.", "Happy to issue a revised invoice if anything needs adjusting. Thanks for the ongoing work — really enjoying the collaboration."],
  // 3 — Build succeeded
  ["Build #4218 completed successfully on `main` in 4m 12s. Tests: 1,247 passed. No regressions detected. Artifact published to the staging registry.", "Changed files: src/components/panel/Panel.tsx, src/design-system/tokens.ts, src/storage/query.ts (47 files total, +2,103 −418).", "Deployment preview: https://nexus-v2-preview.vercel.app/pr/312", "This build is ready for QA sign-off before the production deploy. Ping #releases when you're green."],
  // 4 — Welcome
  ["Welcome aboard — really excited to have you on the team. Below is the onboarding doc with everything you need for week one. Reach out anytime.", "First week checklist: (1) read the architecture doc in /docs, (2) run pnpm dev and break something, (3) ship one small PR to get familiar with the review process, (4) join the Friday design sync.", "Tools you'll need access to: Linear (ask Mae), Vercel (ask Diego), and the design file in Figma (ask Yuki). Slack channels: #engineering, #design, #infra, #random.", "Your manager will do a 1:1 on Thursday to go through the 30-60-90 plan. Don't stress — we move fast but we're also patient with ramp-up."],
  // 5 — Weekly digest
  ["Your weekly digest is ready. There were 14 mentions of you across 6 conversations this week. Top thread: 'Q2 review notes' (5 replies).", "Other highlights: PR #309 received 3 approvals and is queued to merge, the DESIGN-118 ticket moved to In Review, and the offsite recap doc has 12 views.", "Unread: 8 messages in Inbox. Flagged for follow-up: 2 messages (see the Follow-up label). Snoozed: 1 message waking up Monday.", "No urgent items requiring attention today. Have a great weekend."],
  // 6 — Customer call
  ["Got it — sounds great. I'll put together a call summary by EOD and circulate to the wider group. Let me know if you want anything else covered.", "From my notes: the customer wants faster search (mentioned Soundminer twice), better keyboard navigation, and a way to bulk-apply labels. All three are on the roadmap.", "I mentioned that EP-1 handles saved views (which covers part of the bulk-label use case) and that FTS is EP-3. They seemed satisfied with the timeline.", "Next steps: I'll draft a follow-up email to them with the roadmap summary, and schedule a check-in for 6 weeks out."],
  // 7 — 2FA
  ["We've detected a sign-in to your account from a new device. If this was you, you can ignore this email. If not, please review your account security immediately.", "Device: MacBook Pro (macOS 15.1), Location: San Francisco, CA, Time: 2026-05-08 09:14 UTC.", "If you didn't authorize this sign-in, click 'Review account' below and change your password immediately. We recommend enabling 2FA if you haven't already.", "Your recovery codes are attached to this message. Store them somewhere safe — you'll need them if you ever lose access to your authenticator app."],
  // 8 — PR merged
  ["Pull request #312 (`feat(panels): contextual ghosting`) was merged into `main` by alice-chen. 47 files changed, +2,103 −418.", "This PR implements the contextual ghosting behavior described in DESIGN-112. Panels fade to 40% opacity when they lose focus and a sibling panel is being resized.", "Related tickets closed by this merge: DESIGN-112, ENG-44, ENG-61. The ghosting animation uses CSS transitions with `duration-fast` (120ms ease-out).", "Next: the follow-up PR #313 (`feat(panels): resize handle hover state`) is already in review and should land tomorrow."],
  // 9 — Vercel receipt
  ["Thanks for your payment of $20.00 for Vercel Pro — May 2026. This receipt is for your records. Your next billing date is June 8, 2026.", "Account: will@nexus.app | Plan: Pro | Billing cycle: Monthly | Amount: $20.00 (USD).", "Projects on this account: nexus-v2 (5 deployments this month), nexus-landing (2 deployments). Bandwidth used: 4.2 GB of 1 TB included.", "Questions? Visit vercel.com/support or reply to this email."],
];

function generateBodyHtml(i: number, subject: string, snippet: string): string {
  const paragraphs = bodyParagraphs[i % bodyParagraphs.length] ?? [snippet];
  const paras = paragraphs.map((p) => `<p>${p}</p>`).join("\n");
  return `<h2 style="margin:0 0 16px;font-size:16px;font-weight:600">${subject}</h2>\n${paras}`;
}

// ─── Store initialization ─────────────────────────────────────────────────────

let _initialized = false;

export function initStore(): void {
  if (_initialized) return;
  _initialized = true;
  const messages = generateMessages();

  localStore.hydrate({
    vault: { id: VAULT_ID, path: "/nexus-vault", createdAt: now },
    accounts: seedAccounts,
    folders: seedFolders,
    labels: seedLabels,
    statuses: seedStatuses,
    customFieldDefs: seedCustomFieldDefs,
    messages,
    tagUsage: [],
    mutations: [],
  });

  // Populate body store (EP-3)
  for (const msg of messages) {
    bodyStore.set(msg.bodyRef, generateBodyHtml(parseInt(msg.id.replace("email-", ""), 10), msg.subject, msg.snippet));
  }

  // Build FTS index (EP-3)
  ftsIndex.indexMessages(messages, bodyStore);
}

// Auto-initialize when module is imported
initStore();

// ─── Bridge: Message → old Email shape (used until Phase 0c–0e migrate UI) ───

function addrBridge(a: EPAddress): Address {
  return { name: a.name, email: a.email, colorSeed: pickPanelLink(a.email) };
}

function messagesToEmail(msg: Message): Email {
  const lbls: Label[] = msg.labelIds
    .map((id) => localStore.labels.get(id))
    .filter((l): l is EPLabel => l !== undefined && l.kind === "user")
    .map((l) => ({ id: l.id, name: l.name, color: l.color as PanelLink }));

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: addrBridge(msg.fromAddr),
    to: msg.toAddrs.map(addrBridge),
    cc: msg.ccAddrs.length > 0 ? msg.ccAddrs.map(addrBridge) : undefined,
    subject: msg.subject,
    snippet: msg.snippet,
    body: "",
    receivedAt: new Date(msg.receivedAt),
    read: msg.flags.read,
    starred: msg.star !== null,
    labels: lbls,
    attachments: msg.attachmentRefs.map((r) => ({
      name: r.name,
      size: r.size,
      type: r.type,
    })),
    folderId: msg.folderId,
  };
}

// ─── Backward-compat exports (Phase 0b — kept for existing UI components) ────

/** System folder nav items — IDs match system label IDs. */
export const folders: Folder[] = [
  { id: "inbox", name: "Inbox", icon: "Inbox", count: 247, unreadCount: 12, system: true },
  { id: "starred", name: "Starred", icon: "Star", count: 38, unreadCount: 0, system: true },
  { id: "drafts", name: "Drafts", icon: "FileText", count: 4, unreadCount: 0, system: true },
  { id: "sent", name: "Sent", icon: "Send", count: 1452, unreadCount: 0, system: true },
  { id: "snoozed", name: "Snoozed", icon: "AlarmClock", count: 7, unreadCount: 3, system: true },
  { id: "archive", name: "Archive", icon: "Archive", count: 8421, unreadCount: 0, system: true },
  { id: "spam", name: "Spam", icon: "ShieldAlert", count: 19, unreadCount: 0, system: true },
  { id: "trash", name: "Trash", icon: "Trash2", count: 142, unreadCount: 0, system: true },
];

export const customFolders: Folder[] = [
  { id: F.clients, name: "Clients", icon: "Folder", count: 84, unreadCount: 2 },
  { id: F.projects, name: "Projects", icon: "Folder", count: 156, unreadCount: 0 },
  { id: F.receipts, name: "Receipts", icon: "Folder", count: 312, unreadCount: 0 },
  { id: F.newsletters, name: "Newsletters", icon: "Folder", count: 482, unreadCount: 5 },
];

export const accounts: Account[] = [
  { id: A_IDS.main, email: "will@nexus.app", syncStatus: "idle", unread: 12 },
  { id: A_IDS.gmail, email: "will.mcguigan@gmail.com", syncStatus: "syncing", unread: 8 },
];

/** Old label map — kept for any direct references in existing UI. */
export const labels: Record<string, Label> = {
  work: { id: L.work, name: "Work", color: 5 },
  personal: { id: L.personal, name: "Personal", color: 6 },
  followup: { id: L.followup, name: "Follow-up", color: 2 },
  newsletter: { id: L.newsletter, name: "Newsletter", color: 8 },
  receipts: { id: L.receipts, name: "Receipts", color: 3 },
  travel: { id: L.travel, name: "Travel", color: 4 },
};

/**
 * Return emails for a given selection ID (system label, user label, or physical folder).
 * This is the backward-compat version; Phase 0c+ components will query the store directly.
 */
export function emailsByFolder(selectionId: string): Email[] {
  const isSystemLabel = localStore.labels.has(selectionId) &&
    localStore.labels.get(selectionId)?.kind === "system";
  const isUserLabel = localStore.labels.has(selectionId) &&
    localStore.labels.get(selectionId)?.kind === "user";
  const isFolder = localStore.folders.has(selectionId);

  let messages: Message[];
  if (isSystemLabel || isUserLabel) {
    const { items } = queryMessages({ labelIds: [selectionId], limit: 500 }, localStore);
    messages = items;
  } else if (isFolder) {
    const { items } = queryMessages({ folderId: selectionId, limit: 500 }, localStore);
    messages = items;
  } else {
    messages = [];
  }
  return messages.map(messagesToEmail);
}

export function emailById(id: string | null): Email | null {
  if (!id) return null;
  const msg = localStore.messages.get(id);
  return msg ? messagesToEmail(msg) : null;
}

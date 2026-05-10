import { pickPanelLink, type PanelLink } from "@/design-system/tokens";

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

const now = new Date();
function ago(minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

function addr(name: string, email: string): Address {
  return { name, email, colorSeed: pickPanelLink(email) };
}

export const labels: Record<string, Label> = {
  important: { id: "important", name: "Important", color: 1 },
  work: { id: "work", name: "Work", color: 5 },
  personal: { id: "personal", name: "Personal", color: 6 },
  followup: { id: "followup", name: "Follow-up", color: 2 },
  newsletter: { id: "newsletter", name: "Newsletter", color: 8 },
  receipts: { id: "receipts", name: "Receipts", color: 3 },
  travel: { id: "travel", name: "Travel", color: 4 },
};

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
  { id: "f-clients", name: "Clients", icon: "Folder", count: 84, unreadCount: 2 },
  { id: "f-projects", name: "Projects", icon: "Folder", count: 156, unreadCount: 0 },
  { id: "f-receipts", name: "Receipts", icon: "Folder", count: 312, unreadCount: 0 },
  { id: "f-newsletters", name: "Newsletters", icon: "Folder", count: 482, unreadCount: 5 },
];

export const accounts: Account[] = [
  { id: "a1", email: "will@nexus.app", syncStatus: "idle", unread: 12 },
  { id: "a2", email: "will.mcguigan@gmail.com", syncStatus: "syncing", unread: 8 },
];

const senders = [
  addr("Alice Chen", "alice@axiomlabs.io"),
  addr("Bob Marcus", "bob.marcus@northroot.com"),
  addr("Priya Subramanian", "priya@palomar.dev"),
  addr("Diego Hernández", "diego.h@cobaltworks.io"),
  addr("Yuki Tanaka", "yuki@brightpath.studio"),
  addr("GitHub", "noreply@github.com"),
  addr("Stripe", "receipts@stripe.com"),
  addr("Linear", "notifications@linear.app"),
  addr("Mae Patel", "mae@harborline.co"),
  addr("Henry Vasquez", "henry@stagepoint.studio"),
  addr("Cassidy Yong", "cy@meridian.fund"),
  addr("Rohit Sharma", "rohit.sharma@northpath.dev"),
  addr("AWS Billing", "no-reply-aws@amazon.com"),
  addr("Vercel", "support@vercel.com"),
  addr("Substack — Stratechery", "stratechery@substack.com"),
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

const bodies = [
  `<p>Hi team,</p><p>Wanted to share a few updates from this morning's planning session.</p><ul><li>Timeline shifted to mid-June</li><li>Design tokens locked</li><li>Inspector panel scope reduced</li></ul><p>Let me know if anything looks off.</p><p>— Alice</p>`,
  `<p>Hey,</p><p>I've gone through the spec and have a couple of questions about the panel-link palette behavior when a user has more than 8 paired panels.</p><ol><li>Do they recycle?</li><li>Do we surface a warning?</li></ol><p>Open to either approach but want to flag.</p><p>Thanks!</p>`,
  `<p>Please find attached the September invoice for services rendered.</p><p><strong>Net-30 terms apply.</strong></p><p>Wire details haven't changed — let me know if you need them resent.</p>`,
];

function rand<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length] as T;
}

const labelOptions: Label[][] = [
  [labels.work!, labels.important!],
  [labels.work!],
  [labels.personal!],
  [labels.followup!, labels.work!],
  [labels.newsletter!],
  [labels.receipts!],
  [labels.travel!, labels.personal!],
  [],
  [labels.work!, labels.followup!, labels.important!],
  [labels.newsletter!, labels.followup!],
];

function generateEmails(): Email[] {
  const out: Email[] = [];
  let threadCount = 0;
  for (let i = 0; i < 60; i++) {
    const sender = rand(senders, i);
    const subject = rand(subjects, i);
    const snippet = rand(snippets, i);
    const body = rand(bodies, i);
    const minutesAgo = i * 27 + (i % 5) * 13;
    const labelSet = rand(labelOptions, i);
    const hasAttachment = i % 6 === 0;
    const isThread = i % 7 === 3;
    const threadId = isThread
      ? `thread-${threadCount}`
      : `thread-${++threadCount}`;
    if (isThread) threadCount++;
    out.push({
      id: `email-${i.toString().padStart(3, "0")}`,
      threadId,
      from: sender,
      to: [addr("Will McGuigan", "will@nexus.app")],
      cc: i % 11 === 0 ? [addr("Mae Patel", "mae@harborline.co")] : undefined,
      subject,
      snippet,
      body,
      receivedAt: ago(minutesAgo),
      read: i > 4 && i % 3 !== 0,
      starred: i % 9 === 1,
      labels: labelSet,
      attachments: hasAttachment
        ? [
            {
              name: i % 12 === 0 ? "Q2-deck.pdf" : "screenshot.png",
              size: i % 12 === 0 ? 4_212_000 : 482_000,
              type: i % 12 === 0 ? "pdf" : "image",
            },
          ]
        : [],
      folderId: i % 17 === 0 ? "snoozed" : "inbox",
    });
  }
  return out;
}

export const emails: Email[] = generateEmails();

export function emailById(id: string | null): Email | null {
  if (!id) return null;
  return emails.find((e) => e.id === id) ?? null;
}

export function emailsByFolder(folderId: string): Email[] {
  return emails.filter((e) => e.folderId === folderId);
}

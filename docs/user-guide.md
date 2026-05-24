# Nexus — User Guide

Welcome to Nexus, a local-first email client for macOS. This guide walks you through everything from first launch to advanced organization features.

---

## Table of Contents

1. [First Launch — Creating Your Vault](#1-first-launch--creating-your-vault)
2. [Connecting Email Accounts](#2-connecting-email-accounts)
3. [Navigating the Interface](#3-navigating-the-interface)
4. [Reading and Writing Email](#4-reading-and-writing-email)
5. [Organizing Your Email](#5-organizing-your-email)
6. [Custom Fields](#6-custom-fields)
7. [Search and Filtering](#7-search-and-filtering)
8. [Syncing Across Devices](#8-syncing-across-devices)
9. [Keyboard Shortcuts](#9-keyboard-shortcuts)
10. [Privacy and Security](#10-privacy-and-security)

---

## 1. First Launch — Creating Your Vault

When you open Nexus for the first time, you'll be asked to create a **vault** — a folder on your disk where all your mail data will live.

**What is a vault?**
A vault is a folder that Nexus uses to store a local database of your messages, labels, notes, and all other data. Everything you do in Nexus is saved here, on your machine, under your control.

**Choosing a location:**
- Pick a location on a drive that you back up regularly (Time Machine, cloud drive, etc.)
- You can put it anywhere — your Documents folder, an external drive, wherever makes sense
- Avoid network drives or iCloud Drive if you want offline access to work reliably

**After creating the vault:**
Nexus asks you to choose how you want to use it.

### Choosing a mode

**Traditional Client** — Use Nexus as a fast Gmail/IMAP interface. Mail syncs from your provider's servers. No local file copies beyond the database.

**Local-First & Private** *(recommended)* — Your mail is mirrored to real `.eml` files in folders you can browse in Finder, back up, or move around. Changes you make in Finder (moving files between folders) sync back to Nexus automatically. Best for offline access and local archiving.

You can change your mode later in **Settings → Preferences**.

---

## 2. Connecting Email Accounts

Nexus supports Gmail, Outlook/Microsoft 365, and any IMAP/SMTP provider. You can connect multiple accounts to one vault.

### Gmail

1. Open **Settings** (`⌘,`) → **Accounts** → **Add account** → **Gmail**
2. A browser window opens asking you to sign in to Google and authorize Nexus
3. Grant the requested permissions (read and manage mail)
4. Nexus begins syncing your mail in the background

Nexus uses Gmail's **History API** for incremental sync — only new changes are fetched after the initial load.

### Outlook / Microsoft 365

1. **Settings** → **Accounts** → **Add account** → **Outlook**
2. A browser window opens for Microsoft sign-in
3. After authorization, Nexus auto-configures IMAP and SMTP for your account

### IMAP / SMTP (any provider)

Works with Fastmail, iCloud Mail, ProtonMail Bridge, self-hosted mail servers, and any standard IMAP provider.

1. **Settings** → **Accounts** → **Add account** → **IMAP**
2. Enter your email address — Nexus will try to auto-discover the server settings
3. If auto-discovery fails, enter manually: IMAP host + port (usually 993), security (TLS/STARTTLS), SMTP host + port, and your password
4. Click **Test** to verify the connection, then **Save**

### What syncs from providers

- Messages (subject, sender, recipients, body, date)
- Provider labels/folders (mapped to Nexus labels)
- Read/unread state

### What stays local to Nexus

These are never sent to your email provider:
- Workflow status, tags, priority ratings, star styles, notes, custom fields, snooze dates

---

## 3. Navigating the Interface

Nexus uses a flexible panel-based layout. Every panel can be resized, rearranged, and closed. If you accidentally close something, you can reopen it from the View menu or command palette (`⌘K`).

### The main panels

**Navigation panel (left sidebar)**
: Your folder and label tree. System items (Inbox, Sent, Trash, Archive, Snoozed, Starred, Drafts) are at the top. Your custom labels are below. Click any item to filter the mail list to that view.

**Mail list (center)**
: All messages matching your current filter. Switch between list view and kanban view using the toggle in the top right. Sort by date, sender, subject, priority, or any other axis using the sort menu.

**Email viewer (right)**
: Shows the full content of the selected message. Click any message in the list to open it here.

**Inspector panel**
: The metadata editor for the selected message. Shows and lets you edit labels, tags, status, priority, star, flag, notes, and custom fields. Open it by clicking the inspector icon or pressing `⌘I`.

**Command palette**
: Press `⌘K` at any time to search for actions, navigate to any folder or label, or jump to a message by subject. Type any part of what you're looking for.

### Customizing the layout

Drag panel dividers to resize. Drag panel tab headers to rearrange. Use the View menu to show or hide individual panels. Your layout is saved automatically.

---

## 4. Reading and Writing Email

### Reading messages

Click a message in the list to open it in the viewer panel. The viewer shows the full HTML body of the message. Attachments are listed at the bottom of the message.

Messages are automatically marked as read when you open them. To mark as unread, use the right-click context menu or the inspector panel.

### Composing a new message

Press `⌘N` or click the compose button (pencil icon) to open the composer. Fill in the To, Subject, and body fields, then click Send.

### Replying and forwarding

Open a message, then click **Reply**, **Reply All**, or **Forward** at the top of the viewer. The composer opens pre-filled with the appropriate headers.

---

## 5. Organizing Your Email

Nexus gives you more ways to organize email than any standard client. Here's what each tool is for:

### Labels

Labels are the primary organizational tool — equivalent to Gmail labels or JMAP mailboxes. A message can have multiple labels.

- **System labels:** Inbox, Sent, Drafts, Trash, Archive, Snoozed, Starred, Important — these sync with Gmail
- **Custom labels:** Create your own in Settings → Accounts, or via the label picker in the Inspector

To add a label: select a message, open the Inspector, click the label field, and type or pick a label.

### Tags

Tags are lightweight, free-form annotations. Think hashtags. Unlike labels, there's no predefined list — just type `#client` or `#urgent` and Nexus remembers it for autocomplete.

Tags are **Nexus-only** — they don't sync to Gmail. Use them for personal workflow notes.

### Workflow Status

Status represents where a message is in your workflow. Examples: To Review, In Progress, Waiting, Done. Unlike labels, a message can have only **one** status at a time.

Create your own status values in **Settings → Preferences** (or from the status picker in the Inspector). You can mark statuses as terminal (done/archived) to hide them from active views.

### Priority

Four levels: Urgent (1), High (2), Normal (3), Low (4). Use the priority picker in the Inspector to set it. Filter by priority in the filter bar to focus on what matters.

### Star

Twelve visual star styles (star, heart, bookmark, pin, and more in different colors). Purely visual — use the one that means something to you. Set it in the Inspector.

### Flag / Snooze

Flag a message to mark it for follow-up. Add a snooze date to have it reappear at a specific time. Snoozed messages are automatically hidden from Inbox until the snooze expires.

### Notes

Each message has a free-form notes field (markdown supported). Write anything — action items, context, summaries. Notes are Nexus-only (not sent to Gmail) and are full-text searchable.

### Pinning and Muting

**Pin** a message to keep it at the top of any list view.
**Mute** a thread to stop it from appearing in Inbox even when new replies arrive.

### Automation Rules

Automatically apply labels, status, priority, tags, and other actions to incoming messages based on conditions.

**To create a rule:**
1. Open **Settings → Rules**
2. Click **"Add rule"**
3. Set one or more conditions — you can match on sender, subject, whether the message has attachments, existing labels, or tags, using AND or OR logic
4. Pick one or more actions (add label, set status, mark read, archive, etc.)
5. Save and enable the rule

Rules fire once when a new message arrives. You can reorder rules (earlier rules run first) and enable/disable them individually.

### Email Templates

Save reusable email subjects and bodies that you can insert into the composer with one click.

**To create a template:**
1. Open **Settings → Templates** → **"Add template"**
2. Give it a name, subject, and body
3. Save

**To use a template:**
1. Open the composer (`⌘N`, Reply, or Forward)
2. Click the template icon in the toolbar
3. Select a template — the subject and body are filled in automatically. You can still edit before sending.

### Unsubscribing from mailing lists

When a message has a machine-readable unsubscribe link, Nexus shows an **Unsubscribe** button at the bottom of the email viewer. Click it to unsubscribe in one step using the RFC 8058 one-click protocol (or open the unsubscribe URL in your browser if one-click isn't supported).

---

## 6. Custom Fields

Custom fields let you add your own data axes to any message — like Airtable for email.

### Creating a custom field

1. Open **Settings → Custom Fields**
2. Click **"Add field"**
3. Choose a type: Text, Long text, Number, Date, URL, Email, Boolean (yes/no), Select (single-choice), Multi-select, or Person
4. For Select and Multi-select, add your options with optional color coding
5. Give the field a name and click Save

### Using a custom field

Open the Inspector for any message. Your custom fields appear in the Custom Fields section. Click any field to edit its value.

### Filtering by custom fields

In the filter bar above the mail list, click **"+ Add filter"** and choose your custom field from the list. You can filter by value, presence, or range (for number/date fields).

---

## 7. Search and Filtering

### Full-text search

Press `⌘F` or click the search bar to search by subject and notes across all your messages. Search uses a local FTS5 index — results appear instantly without any network request.

### Filter bar

The filter bar lets you combine multiple filters using AND logic. Click **"+ Add filter"** to add filters for:

- **Label** — messages with a specific label
- **Tag** — messages with a specific tag
- **Status** — messages in a specific workflow status
- **Priority** — messages at or above a priority level
- **Star** — messages with a specific star style
- **Flagged / Pinned / Muted / Read** — boolean flags
- **Custom fields** — any custom field you've created
- **Date range** — messages sent between two dates
- **Sender / Recipient** — messages from or to a specific address

### Saving a view

Once you've built a filter combination you use often, click **"Save view"** in the filter bar. Saved views appear in the left navigation panel under "Views" for one-click access.

### Kanban view

Click the kanban icon in the mail list toolbar to switch from list view to a kanban board. You can group by Status, Priority, or any select-type custom field. Drag messages between columns to update their values.

---

## 8. Syncing Across Devices

By default, all your data is local. If you want to keep a second Mac (or future mobile device) in sync, set up the optional E2EE relay.

**How it works:**
Every change you make is encrypted on your device and pushed to a relay server you control. Your other devices pull and decrypt those changes. The relay never has access to your vault key or message content.

**To set up sync:**

1. Open **Settings → Relay**
2. Choose **Self-Hosted** (Nexus-hosted relay is coming soon)
3. Follow the setup instructions in [docs/relay.md](relay.md) to start a relay server
4. Enter the relay URL and click **Save**
5. To add a second device: click **"Generate link code"**, then enter the code on the second device

See [Relay Setup Guide](relay.md) for detailed instructions.

---

## 9. Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` | Open command palette |
| `⌘N` | Compose new message |
| `⌘,` | Open settings |
| `⌘F` | Focus search bar |
| `⌘I` | Toggle inspector panel |
| `⌘R` | Reply to selected message |
| `⌘⇧R` | Reply all |
| `⌘⇧F` | Forward selected message |
| `E` | Archive selected message |
| `#` | Move to trash |
| `U` | Toggle read/unread |
| `S` | Toggle star |
| `⌘⇧I` | Mark as important |
| `J` / `↓` | Next message |
| `K` / `↑` | Previous message |
| `Enter` | Open selected message |
| `Escape` | Close composer / popover |
| `?` | Show keyboard shortcut help |

---

## 10. Privacy and Security

### What stays on your machine

Everything, by default:
- All message bodies and attachments (cached locally)
- All metadata: labels, tags, status, priority, notes, custom fields
- Your vault key (stored only in your local SQLite database)

### What leaves your machine

- **To Google:** Message content when you send, Gmail sync API calls (read/write to your Gmail account — this is the email provider relationship you already have)
- **To the relay (if configured):** Encrypted mutation blobs — changes to metadata (labels, status, tags, etc.). The relay **cannot decrypt these**. Message bodies are never sent to the relay.

### Vault encryption

Your local vault database is encrypted with SQLCipher (256-bit AES). The encryption key is derived from a random vault key stored in the `vault_key` table of the database itself. This means the database file is encrypted on disk, but the key is in the same database — the primary protection is the vault key you back up separately.

### Relay sync E2EE

When relay sync is enabled, every mutation (metadata change) is encrypted with **XChaCha20-Poly1305** using your 32-byte vault key before being sent to the relay. The nonce is random per mutation and prepended to the ciphertext. The relay server:

- Stores encrypted blobs and sequence numbers
- Never sees your vault key
- Cannot decrypt any message content or metadata

See [Settings → Relay → "Show vault key"](../src/components/settings/SettingsPanel.tsx) to export your vault key for safekeeping.

### Device enrollment security

When linking a new device, a 6-digit enrollment code is used to transfer the vault key. The relay stores:
- A SHA-256 hash of the code (cannot be reversed to recover the code)
- Your vault key encrypted with a BLAKE3-derived key from the code

The session expires after 10 minutes and allows a maximum of 10 entry attempts. A compromised relay cannot extract your vault key from an enrollment session without knowing the 6-digit code.

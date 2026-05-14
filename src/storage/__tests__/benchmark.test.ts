/**
 * Gate 0g: 100k filter benchmark.
 *
 * Canonical multi-axis query must run in <10ms on 100k messages:
 *   LBL=lbl-work AND STA=sta-triage AND maxPriority=2 AND TAG=urgent AND CFD.project=acme
 *
 * Single-axis queries are verified for correctness (not timing), since sorting
 * 16k+ results dominates in Node.js but is <5ms in browser V8.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { LocalStore } from "@/storage/local";
import { queryMessages } from "@/storage/query";
import { generateSyntheticMessages } from "@/data/fixtures";
import type { Folder, Label, Status, CustomFieldDef } from "@/data/types";

const VAULT_ID = "local";
const LABEL_WORK = "lbl-work";
const STATUS_TRIAGE = "sta-triage";
const CFD_PROJECT = "cfd-project";
const TAG_URGENT = "urgent";

let benchStore: LocalStore;

beforeAll(() => {
  benchStore = new LocalStore();

  const folders: Folder[] = [
    {
      id: "fld-inbox", vaultId: VAULT_ID, parentId: null,
      name: "Inbox", diskSlug: "Inbox", diskPath: "Inbox",
    },
  ];
  const labels: Label[] = [
    { id: "inbox", vaultId: VAULT_ID, name: "Inbox", color: 5, kind: "system", systemKind: "inbox", position: 0 },
    { id: LABEL_WORK, vaultId: VAULT_ID, name: "Work", color: 5, kind: "user", position: 0 },
    { id: "lbl-personal", vaultId: VAULT_ID, name: "Personal", color: 6, kind: "user", position: 1 },
    { id: "lbl-newsletter", vaultId: VAULT_ID, name: "Newsletter", color: 8, kind: "user", position: 2 },
    { id: "lbl-receipts", vaultId: VAULT_ID, name: "Receipts", color: 3, kind: "user", position: 3 },
    { id: "lbl-travel", vaultId: VAULT_ID, name: "Travel", color: 4, kind: "user", position: 4 },
  ];
  const statuses: Status[] = [
    { id: STATUS_TRIAGE, vaultId: VAULT_ID, name: "Triage", color: 1, position: 0, isDefault: true },
    { id: "sta-reading", vaultId: VAULT_ID, name: "Reading", color: 2, position: 1 },
    { id: "sta-awaiting", vaultId: VAULT_ID, name: "Awaiting", color: 3, position: 2 },
    { id: "sta-action", vaultId: VAULT_ID, name: "Action", color: 4, position: 3 },
    { id: "sta-done", vaultId: VAULT_ID, name: "Done", color: 5, position: 4, isTerminal: true },
  ];
  const customFieldDefs: CustomFieldDef[] = [
    {
      id: CFD_PROJECT, vaultId: VAULT_ID, name: "Project", type: "select",
      options: [
        { id: "cfd-proj-opt-nexus", label: "Nexus", color: 5, position: 0 },
        { id: "cfd-proj-opt-acme", label: "Acme", color: 2, position: 1 },
        { id: "cfd-proj-opt-horizon", label: "Horizon", color: 4, position: 2 },
      ],
      position: 0,
    },
  ];

  benchStore.hydrate({
    vault: { id: VAULT_ID, path: "/", createdAt: Date.now() },
    accounts: [],
    folders,
    labels,
    statuses,
    customFieldDefs,
    messages: generateSyntheticMessages(100_000),
    tagUsage: [],
    mutations: [],
  });
});

describe("100k filter benchmark", () => {
  it("store contains exactly 100k messages after seeding", () => {
    expect(benchStore.messages.size).toBe(100_000);
  });

  it("canonical 5-axis query (LBL+STA+PRI+TAG+CFD) runs in <10ms on 100k messages", () => {
    const result = queryMessages(
      {
        labelIds: [LABEL_WORK],
        statusId: STATUS_TRIAGE,
        maxPriority: 2,
        tags: [TAG_URGENT],
        customFieldValues: { [CFD_PROJECT]: "cfd-proj-opt-acme" },
        limit: 500,
      },
      benchStore,
    );

    // Gate 0g hard requirement: canonical query must complete in <10ms
    expect(result.took).toBeLessThan(10);
    // Sanity: index intersection produces correct candidates
    expect(result.items.every((m) => m.labelIds.includes(LABEL_WORK))).toBe(true);
    expect(result.items.every((m) => m.statusId === STATUS_TRIAGE)).toBe(true);
    expect(result.items.every((m) => m.priority !== null && m.priority <= 2)).toBe(true);
  });

  it("3-axis query (LBL+STA+PRI) index intersection narrows candidates correctly", () => {
    const result = queryMessages(
      {
        labelIds: [LABEL_WORK],
        statusId: STATUS_TRIAGE,
        maxPriority: 2,
        limit: 500,
      },
      benchStore,
    );

    // All returned messages satisfy every filter
    expect(result.items.every((m) => m.labelIds.includes(LABEL_WORK))).toBe(true);
    expect(result.items.every((m) => m.statusId === STATUS_TRIAGE)).toBe(true);
    expect(result.items.every((m) => m.priority !== null && m.priority <= 2)).toBe(true);
  });

  it("single-axis label query returns messages with that label", () => {
    const result = queryMessages(
      { labelIds: [LABEL_WORK], limit: 500 },
      benchStore,
    );
    // ~1/6 of 100k = ~16,666 total; pagination gives 500 back
    expect(result.total).toBeGreaterThan(10_000);
    expect(result.items.length).toBe(500);
    expect(result.items.every((m) => m.labelIds.includes(LABEL_WORK))).toBe(true);
  });

  it("single-axis status query returns messages with that status", () => {
    const result = queryMessages(
      { statusId: STATUS_TRIAGE, limit: 500 },
      benchStore,
    );
    // ~1/5 of 100k = ~20,000 total
    expect(result.total).toBeGreaterThan(10_000);
    expect(result.items.every((m) => m.statusId === STATUS_TRIAGE)).toBe(true);
  });

  it("tag index correctly indexes messages with tags", () => {
    const result = queryMessages(
      { tags: [TAG_URGENT], limit: 500 },
      benchStore,
    );
    // Messages have urgent tag when i%7===0 AND tag slot gives urgent
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((m) => m.tags.includes(TAG_URGENT))).toBe(true);
  });

  it("custom field EAV index returns matching messages only", () => {
    const result = queryMessages(
      { customFieldValues: { [CFD_PROJECT]: "cfd-proj-opt-acme" }, limit: 500 },
      benchStore,
    );
    expect(result.total).toBeGreaterThan(0);
    expect(result.items.every((m) => m.customFields[CFD_PROJECT] === "cfd-proj-opt-acme")).toBe(true);
  });
});

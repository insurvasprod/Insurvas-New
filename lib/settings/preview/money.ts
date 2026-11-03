/**
 * Sample data for Settings › Money & compliance in the preview (settings-redesign R2). Accounting and
 * Retention are handed their data by the server, so the preview hands them these props; Compliance
 * fetches, so it gets handlers. Built from each module's own client-safe defaults. Nothing reaches a
 * real API.
 */
import { ACCOUNTING_DEFAULTS, LOCKED } from "@/lib/accounting/settingsCore";
import { VERIFICATION_METHODS } from "@/lib/compliance/dataSubject";
import { GAP_KEYS } from "@/lib/compliance/evidenceGaps";
import type { RuleRow } from "@/lib/compliance/retention";
import { DEFAULT_OWNER_ROLE } from "@/lib/retention/assignment";
import { PLATFORM_DEFAULT_SETTINGS, PLATFORM_DEFAULT_WEIGHTS } from "@/lib/retention/constants";
import type { Hub } from "@/lib/retention/settingsHubStore";

const ago = (days: number) => new Date(Date.parse("2026-10-28T16:00:00Z") - days * 86_400_000).toISOString();

/* ── Accounting ────────────────────────────────────────────────────────────────────────────── */

export const PREVIEW_ACCOUNTING = {
  initial: ACCOUNTING_DEFAULTS,
  locked: LOCKED,
  changes: [
    { field: "reserveMonths", from: 2, to: 3, by: "user-umar", at: ago(4) },
    { field: "overdueDays", from: 30, to: 45, by: "user-lena", at: ago(12) },
  ],
  accounts: [
    { id: "ba1", nickname: "Operating", bankName: "Chase", lastFour: "4410", columnMap: { date: "Posting Date", description: "Description", amount: "Amount" } },
    { id: "ba2", nickname: "Commissions", bankName: "Frost Bank", lastFour: "9921", columnMap: null },
  ],
};

/* ── Retention ─────────────────────────────────────────────────────────────────────────────── */

export const PREVIEW_RETENTION: Hub = {
  settings: PLATFORM_DEFAULT_SETTINGS,
  weights: PLATFORM_DEFAULT_WEIGHTS,
  weightVersion: 1,
  weightIsPlatform: true,
  platformWeights: PLATFORM_DEFAULT_WEIGHTS,
  distribution: { all: [412, 280, 166, 94, 51, 30, 18, 9, 4, 2], eligible: [0, 0, 0, 61, 42, 27, 16, 8, 4, 2] },
  rules: DEFAULT_OWNER_ROLE,
  reps: [{ userId: "user-rosa", name: "Rosa Patel" }, { userId: "user-james", name: "James Turner" }],
  carriers: [{ id: "car-mutual", name: "Mutual of Omaha" }, { id: "car-aetna", name: "Aetna" }, { id: "car-foresters", name: "Foresters" }],
  changes: [{ setting: "workedCooldownDays", from: 14, to: 10, by: "Umar Masood", at: ago(6) }],
};

/* ── Compliance (fetched) ──────────────────────────────────────────────────────────────────── */

const rule = (id: string, recordType: string, retainDays: number | null, action: string, basis: string, tenant = false): RuleRow => ({
  id, tenantId: tenant ? "tenant-preview" : null, recordType, state: null, retainDays, action, basis, notes: null, setAt: ago(90),
});

const compliance = {
  settings: {
    gate: { consentMissing: "warn", timeoutMs: 2000, federalDnc: true, consent: true, existingCustomer: true, callingHours: true },
    complaints: { amberDays: 10, redDays: 5 },
    deletion: { holdDays: 7, methods: [...VERIFICATION_METHODS], performerRoles: ["owner"] },
    purge: { scheduleEnabled: false, windowDays: 7, recipients: [] },
    report: { roles: ["owner", "producer"], gapChecks: [...GAP_KEYS] },
    dashboard: { hiddenTiles: [], monthlyEmail: true, recipients: ["user-umar"] },
  },
  caps: { deletionHoldFloorDays: 3, lockedGateChecks: ["federalDnc"], neverDelete: ["complaint_records", "policy_commission_records"] },
  deadlines: {
    available: true,
    rows: [{ regulator: "TX", responseDays: 15, notes: "Texas Department of Insurance" }, { regulator: "FL", responseDays: 20, notes: null }, { regulator: "GA", responseDays: 10, notes: null }],
    coverage: { licensed: 5, covered: 3, missing: ["AL", "TN"], ftc: true, sentence: "3 of your 5 licensed states have a response deadline on file; AL and TN fall back to 30 days." },
  },
  rules: [
    rule("r1", "consent_artefacts", 1825, "purge", "TCPA: five years after the last call"),
    rule("r2", "call_attempt_logs", 1095, "purge", "Three years"),
    rule("r3", "lead_data_unconverted", 365, "purge", "Agency policy", true),
    rule("r4", "complaint_records", null, "keep", "Never deleted"),
  ],
  holds: [{ id: "h1", scope: "phone_digits", scopeValue: "2145550199", reason: "litigation", sourceId: null, note: "Demand letter received 12 Oct.", placedBy: "Umar Masood", placedAt: ago(16), releasedAt: null, releaseNote: null, automatic: false }],
  runs: [{ id: "run1", mode: "dry_run", startedAt: ago(1), finishedAt: ago(1), results: [{ record_type: "lead_data_unconverted", table: "leads", rows_matched: 214, rows_held: 3, rows_purged: 0 }], heldCount: 3, unruled: ["nurture_winback_candidates"], triggeredBy: "schedule", summaryDelivered: 1, acknowledgedAt: null, liveSkippedReason: null }],
  changes: [{ section: "transfer_gate", setting: "gate.timeoutMs", from: 3000, to: 2000, by: "Umar Masood", at: ago(9) }],
  team: [{ id: "user-umar", role: "owner", name: "Umar Masood" }, { id: "user-rinor", role: "producer", name: "Rinor Krasniqi" }, { id: "user-lena", role: "bookkeeper", name: "Lena Ortiz" }],
};

type Answer = { status: number; body: unknown };
type State = "loaded" | "empty" | "error" | "readonly";

export const MONEY_HANDLERS: Record<string, (state: State, body: unknown) => Answer> = {
  "GET /api/app/compliance/settings": (state) => (state === "error" ? { status: 500, body: { error: "Could not load the compliance settings. (Sample error.)" } } : { status: 200, body: compliance }),
  "PATCH /api/app/compliance/settings": () => ({ status: 200, body: compliance }),
  "PUT /api/app/compliance/settings": () => ({ status: 200, body: compliance }),
};

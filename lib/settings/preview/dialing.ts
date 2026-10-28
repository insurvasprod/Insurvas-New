/**
 * Sample answers for Settings › Leads & dialing and Platform › API keys & webhooks in the preview
 * (settings-redesign R2). Reads only, plus saves that answer with what the GET says; nothing reaches
 * a real API.
 */
import { DEFAULT_CADENCE } from "@/lib/cadence/engine";
import type { ApiKeyView, WebhookView } from "@/lib/apiKeys/constants";
import type { CallingWindowSettings } from "@/lib/callingWindow/engine";
import type { DispositionSettingsRow } from "@/lib/dispositions/types";
import type { PostKeysLoaded } from "@/lib/leadPost/types";
import type { Pipeline, PipelineStage } from "@/lib/pipelines/types";

type Answer = { status: number; body: unknown };
type State = "loaded" | "empty" | "error" | "readonly";
const ok = (body: unknown): Answer => ({ status: 200, body });
const failed = (what: string): Answer => ({ status: 500, body: { error: `Could not load ${what}. (Sample error.)` } });
const ago = (days: number) => new Date(Date.parse("2026-10-28T16:00:00Z") - days * 86_400_000).toISOString();
const TENANT = "tenant-preview";
const STAMP = "2026-09-01T12:00:00Z";

/* ── Pipelines & outcomes ───────────────────────────────────────────────────────────────────── */

const stage = (pipeline_id: string, id: string, name: string, position: number, stage_type: PipelineStage["stage_type"], color: string, description: string): PipelineStage => ({
  id, pipeline_id, name, position, stage_type, color, description, is_archived: false, created_at: STAMP, updated_at: STAMP,
});

const pipelines: Pipeline[] = [
  {
    id: "pl-main", tenant_id: TENANT, name: "All leads", partner_type: null, is_default: true, created_at: STAMP, updated_at: STAMP,
    stages: [
      stage("pl-main", "st-new", "New", 0, "open", "#64748b", "Not called yet."),
      stage("pl-main", "st-contacted", "Contacted", 1, "open", "#0ea5e9", "Spoke to the client at least once."),
      stage("pl-main", "st-quoted", "Quoted", 2, "open", "#8b5cf6", "Has a saved quote."),
      stage("pl-main", "st-app", "Application started", 3, "open", "#f59e0b", "An application is open."),
      stage("pl-main", "st-sold", "Sold", 4, "won", "#10b981", "Submitted to the carrier."),
      stage("pl-main", "st-lost", "Lost", 5, "lost", "#ef4444", "Not interested, or not reachable."),
    ],
  },
  {
    id: "pl-transfers", tenant_id: TENANT, name: "Live transfers", partner_type: "publisher", is_default: true, created_at: STAMP, updated_at: STAMP,
    stages: [
      stage("pl-transfers", "st-t-new", "Transferred", 0, "open", "#64748b", "Arrived from a partner."),
      stage("pl-transfers", "st-t-quoted", "Quoted", 1, "open", "#8b5cf6", "Has a saved quote."),
      stage("pl-transfers", "st-t-sold", "Sold", 2, "won", "#10b981", "Submitted to the carrier."),
      stage("pl-transfers", "st-t-lost", "Lost", 3, "lost", "#ef4444", "Not a fit."),
    ],
  },
];

const outcome = (id: string, disposition_key: string, label: string, sort_order: number, worked: boolean, closes_as: "completed" | "dropped", next: DispositionSettingsRow["next"], mapped: string | null): DispositionSettingsRow => ({
  id, tenant_id: TENANT, disposition_key, label, counts_as_work_completed: worked, closes_as, is_active: true, sort_order, created_at: STAMP, updated_at: STAMP,
  ends_call: next?.kind === "close" || next?.kind === "suppress", next_action: next?.kind ?? null, next_action_minutes: next?.minutes ?? null,
  ends_call_fixed: disposition_key === "do_not_call" || disposition_key === "callback_scheduled", next,
  mapped_stage: mapped ? { id: mapped, name: pipelines[0].stages.find((s) => s.id === mapped)?.name ?? "", stage_type: "open", pipeline_id: "pl-main", pipeline_name: "All leads" } : null,
});

const outcomes: DispositionSettingsRow[] = [
  outcome("d1", "no_answer", "No answer", 0, false, "dropped", { kind: "cadence", minutes: null }, null),
  outcome("d2", "voicemail", "Left voicemail", 1, true, "dropped", { kind: "retry", minutes: 240 }, "st-contacted"),
  outcome("d3", "quoted", "Quoted", 2, true, "completed", { kind: "callback", minutes: null }, "st-quoted"),
  outcome("d4", "sold", "Sold", 3, true, "completed", { kind: "close", minutes: null }, "st-sold"),
  outcome("d5", "not_interested", "Not interested", 4, true, "dropped", { kind: "rest", minutes: 43200 }, "st-lost"),
  outcome("d6", "callback_scheduled", "Callback booked", 5, true, "completed", { kind: "callback", minutes: null }, null),
  outcome("d7", "do_not_call", "Do not call", 6, true, "dropped", { kind: "suppress", minutes: null }, "st-lost"),
];

/* ── Calendar & availability ───────────────────────────────────────────────────────────────── */

const weekdays = (start: string, end: string) => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: start, endTime: end }));
const policy = { appointmentMinutes: 30, bufferMinutes: 10, maxPerDay: 8, allowSameDay: true, honourLinkedCalendars: true, allowDoubleBooking: false };
const calendar = {
  members: [
    { userId: "user-umar", name: "Umar Masood", role: "owner", timezone: "America/Chicago", hours: weekdays("09:00", "17:00"), blocks: [{ id: "b1", startsAt: "2026-11-26T00:00:00Z", endsAt: "2026-11-27T00:00:00Z", reason: "Thanksgiving", repeats: "yearly" }], policy },
    { userId: "user-rinor", name: "Rinor Krasniqi", role: "producer", timezone: "America/Chicago", hours: weekdays("10:00", "19:00"), blocks: [], policy: { ...policy, maxPerDay: 10 } },
    { userId: "user-rosa", name: "Rosa Patel", role: "producer", timezone: "America/New_York", hours: [], blocks: [], policy },
  ],
  canEditOthers: true, selfUserId: "user-umar", schema: { settingsReady: true, bookingReady: true }, agency: { maxPerDay: 40, callbackReminderMinutes: 10 }, isAgency: true,
};
const connections = {
  available: true,
  providers: [{ id: "google", label: "Google Calendar", configured: true }, { id: "microsoft", label: "Outlook", configured: true }],
  connections: [{ id: "cc1", userId: "user-umar", provider: "google", status: "connected", accountEmail: "umar.m@powerpolicies.com", lastSyncedAt: ago(0.02), lastError: null }],
};

/* ── Dialing cadence, inbound transfers, calling windows ───────────────────────────────────── */

const cadence = { rows: DEFAULT_CADENCE, usingDefaults: true, defaults: DEFAULT_CADENCE, campaigns: [{ id: "cmp-fe", name: "Final Expense — Texas" }, { id: "cmp-ma", name: "Medicare AEP" }], schemaReady: true, maxAttempts: { own: null, inherited: 7, effective: 7, ready: true }, canEdit: true };

const sla = {
  settings: { warn_after_seconds: 45, escalate_after_seconds: 120, partner_notify_after_seconds: 300, expire_after_seconds: 900 },
  lastSevenDays: { since: ago(7), claimedInsideWarn: 182, claimed: 214, warned: 32, escalated: 9, partnerTold: 3, expired: 2, medianClaimSeconds: 21, sampleCapped: false },
  oldestWaitingSeconds: null, schema: { nurtureOnExpiry: true }, job: { state: "ok" },
};

const callingWindows = (): CallingWindowSettings & { canEdit: boolean } => ({
  federal: { startHour: 8, endHour: 21 },
  tenant: { startHour: 9, endHour: 20, startMinute: 540, endMinute: 1200 },
  campaigns: [{ id: "cmp-ma", name: "Medicare AEP", startHour: 10, endHour: 19, startMinute: 600, endMinute: 1140, reason: "Seniors prefer daytime calls." }],
  stateRules: [
    { state: "FL", startHour: 8, endHour: 20, noSunday: true, noHolidays: true, startMinute: 480, endMinute: 1200, sundayStartMinute: null, sundayEndMinute: null },
    { state: "TX", startHour: 9, endHour: 21, noSunday: false, noHolidays: false, startMinute: 540, endMinute: 1260, sundayStartMinute: 720, sundayEndMinute: 1260 },
    { state: "AL", startHour: 8, endHour: 20, noSunday: true, noHolidays: true, startMinute: 480, endMinute: 1200, sundayStartMinute: null, sundayEndMinute: null },
  ],
  stateRulesAvailable: true, stateCheckReadsFederalHolidays: true,
  options: { noSunday: false, noFederalHolidays: true, campaignOverrides: true },
  schemaReady: true,
  federalHolidays: [{ date: "2026-11-11", name: "Veterans Day" }, { date: "2026-11-26", name: "Thanksgiving Day" }, { date: "2026-12-25", name: "Christmas Day" }],
  rulesFeed: { lastRefreshedAt: ago(2), source: "Insurvas", staleAfterDays: 30, stale: false },
  dialingStates: ["AL", "FL", "GA", "TN", "TX"],
  canEdit: true,
});

/* ── Lead posting ──────────────────────────────────────────────────────────────────────────── */

const leadPosting = (empty: boolean): PostKeysLoaded => ({
  keys: empty ? [] : [
    { id: "pk1", vendorId: "v-northline", vendorName: "Northline Media", keyPrefix: "lp_live_8f2a", fieldMap: { first_name: "fname", last_name: "lname", phone: "phone1", state: "st", date_of_birth: "dob" }, fieldNotes: { date_of_birth: "They send MM/DD/YYYY." }, campaignId: "cmp-fe", isActive: true, createdAt: ago(60), rotatedAt: null, lastUsedAt: ago(0.1) },
    { id: "pk2", vendorId: "v-harbor", vendorName: "Harbor Leads", keyPrefix: "lp_live_c71d", fieldMap: { first_name: "first", last_name: "last", phone: "phone" }, fieldNotes: {}, campaignId: null, isActive: true, createdAt: ago(20), rotatedAt: null, lastUsedAt: ago(3) },
  ],
  vendors: [{ id: "v-northline", name: "Northline Media" }, { id: "v-harbor", name: "Harbor Leads" }],
  campaigns: [{ id: "cmp-fe", name: "Final Expense — Texas", vendorId: "v-northline", status: "active" }],
  stats: empty ? [] : [{ keyId: "pk1", posts: 412, rejected: 18, perVendor: false, earlierPosts: 0, earlierRejected: 0 }, { keyId: "pk2", posts: 96, rejected: 11, perVendor: false, earlierPosts: 0, earlierRejected: 0 }],
  rejections: empty ? [] : [{ reasonCode: "duplicate", count: 17 }, { reasonCode: "missing_phone", count: 8 }, { reasonCode: "outside_states", count: 4 }],
  windowDays: 30, schemaReady: true, workspaceId: TENANT,
});

/* ── API keys & webhooks ───────────────────────────────────────────────────────────────────── */

const keys: ApiKeyView[] = [
  { id: "ak1", label: "Zapier", keyPrefix: "ins_live_3f9c", lastFour: "a81e", scopes: ["leads:write", "leads:read"], createdAt: ago(90), createdByName: "Umar Masood", lastUsedAt: ago(0.2), lastUsedIp: "34.201.10.4", expiresAt: null, revokedAt: null, rotatedFrom: null },
  { id: "ak2", label: "Reporting warehouse", keyPrefix: "ins_live_77b0", lastFour: "0c42", scopes: ["policies:read", "commissions:read"], createdAt: ago(200), createdByName: "Umar Masood", lastUsedAt: ago(1), lastUsedIp: "52.14.88.9", expiresAt: ago(-5), revokedAt: null, rotatedFrom: null },
];
const webhooks: WebhookView[] = [
  { id: "wh1", label: "CRM sync", targetUrl: "https://hooks.example.test/insurvas", eventTypes: ["policy.issued", "policy.lapsed"], status: "active", createdAt: ago(80), lastSuccessAt: ago(0.1), lastFailureAt: null, consecutiveFailures: 0, disabledAt: null, disabledReason: null, pending: 0 },
  { id: "wh2", label: "Finance alerts", targetUrl: "https://finance.example.test/webhook", eventTypes: ["commission.discrepancy_found"], status: "failing", createdAt: ago(30), lastSuccessAt: ago(4), lastFailureAt: ago(0.05), consecutiveFailures: 6, disabledAt: null, disabledReason: null, pending: 3 },
];

export const DIALING_HANDLERS: Record<string, (state: State, body: unknown) => Answer> = {
  "GET /api/app/pipelines": (state) => (state === "error" ? failed("your pipelines") : ok({ pipelines, counts: { stages: { "st-new": 142, "st-contacted": 61, "st-quoted": 23, "st-app": 9, "st-sold": 48, "st-lost": 77, "st-t-new": 12 } } })),
  "GET /api/app/dispositions/config": () => ok({ dispositions: outcomes, next_action_available: true }),
  "GET /api/app/pipelines/dispositions": () => ok({ mappings: outcomes.filter((o) => o.mapped_stage).map((o) => ({ stage_id: o.mapped_stage!.id, disposition_key: o.disposition_key })), pipelineOutcomes: { ready: true, rows: [] } }),
  "GET /api/app/leads/pipeline-context": () => ok({ schemaReady: true, stageRules: { "st-new": { timeAllowedMinutes: 60, countsAsWorked: false }, "st-quoted": { timeAllowedMinutes: 2880, countsAsWorked: true } }, dispositionsByStage: {}, unmapped: [], draftPipelineIds: [], stageDrift: 0 }),
  "GET /api/app/availability": (state) => (state === "error" ? failed("your calendar") : ok(calendar)),
  "GET /api/app/calendar-connections": () => ok(connections),
  "GET /api/app/cadence": (state) => (state === "error" ? failed("the dialing cadence") : ok(cadence)),
  "GET /api/app/queue-sla-settings": (state) => (state === "error" ? failed("the inbound transfer settings") : ok(sla)),
  "GET /api/app/calling-windows": (state) => (state === "error" ? failed("the calling windows") : ok(callingWindows())),
  "GET /api/app/lead-post-keys": (state) => (state === "error" ? failed("your lead posting keys") : ok(leadPosting(state === "empty"))),
  "GET /api/app/api-keys": (state) => (state === "error" ? failed("your API keys") : ok({ keys: state === "empty" ? [] : keys })),
  "GET /api/app/webhooks": () => ok({ webhooks }),
};

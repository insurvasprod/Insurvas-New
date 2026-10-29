/**
 * Sample API answers for the Settings preview (settings-shell plan, R1). The real panels render from
 * these on /design/settings, so a redesign is seen in every state without an account. Each entry is
 * keyed "METHOD /api/path"; a GET answers with the sample, a write answers after a short delay with
 * what the GET would now say. Nothing here reaches a real API.
 *
 * Add a section's fixtures with the task that redesigns it. `PREVIEW_SECTIONS` lists the sections
 * whose real panel renders here; the others keep the placeholder card.
 */
import type { AgencyProfileResponse } from "@/lib/agencyProfile/types";
import type { WorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";
import type { TeamSnapshot } from "@/lib/tenantTeam/service";
import { CARRIER_HANDLERS } from "@/lib/settings/preview/carriers";
import { DIALING_HANDLERS } from "@/lib/settings/preview/dialing";
import { FORM_HANDLERS } from "@/lib/settings/preview/forms";
import { MONEY_HANDLERS } from "@/lib/settings/preview/money";
import { PARTNER_HANDLERS } from "@/lib/settings/preview/partners";

export type PreviewState = "loaded" | "empty" | "error" | "readonly";
export const PREVIEW_STATES: PreviewState[] = ["loaded", "empty", "error", "readonly"];

type Answer = { status: number; body: unknown };
type Handler = (state: PreviewState, body: unknown) => Answer;

const ok = (body: unknown): Answer => ({ status: 200, body });
const failed = (what: string): Answer => ({ status: 500, body: { error: `Could not load ${what}. (Sample error.)` } });

/* ── Business identity ─────────────────────────────────────────────────────────────────────── */

const agencyProfile = (empty: boolean): AgencyProfileResponse => ({
  schemaReady: true,
  niprConfigured: false,
  profile: {
    legalName: empty ? "" : "Unlimited Insurance LLC",
    dba: empty ? null : "Power Policies",
    npn: empty ? null : "12312312",
    npnVerifiedAt: null,
    npnCheckStatus: null,
    npnCheckedAt: null,
    entityType: empty ? null : "llc",
    taxIdType: empty ? null : "ein",
    hasTaxId: !empty,
    taxIdLast4: empty ? null : "4821",
    taxIdReadable: true,
    addressLine1: empty ? null : "1200 Main St",
    addressLine2: empty ? null : "Suite 400",
    city: empty ? null : "Dallas",
    state: empty ? null : "TX",
    postalCode: empty ? null : "75201",
    country: "US",
    principalAddress: empty ? null : "1200 Main St, Suite 400, Dallas, TX 75201",
    phone: empty ? null : "(214) 555-0148",
    email: empty ? null : "ops@powerpolicies.com",
    website: empty ? null : "powerpolicies.com",
    logoUrl: null,
    timezone: "America/Chicago",
    updatedAt: "2026-10-27T15:04:00Z",
  },
});

/* ── Products ──────────────────────────────────────────────────────────────────────────────── */

/** `sold` is always `inPlan && enabled`, as the server derives it; the sample keeps to that. */
type ProductRow = { code: string; name: string; category: string; inPlan: boolean; enabled: boolean; sold: boolean; partners: string[]; formReady: boolean; carriers: number };

let products: ProductRow[] = [
  { code: "final_expense", name: "Final Expense", category: "life", inPlan: true, enabled: true, sold: true, partners: ["Apex Call Center", "Northline Media"], formReady: true, carriers: 4 },
  { code: "term_life", name: "Term Life", category: "life", inPlan: true, enabled: true, sold: true, partners: ["Apex Call Center"], formReady: true, carriers: 3 },
  { code: "whole_life", name: "Whole Life", category: "life", inPlan: true, enabled: false, sold: false, partners: [], formReady: true, carriers: 2 },
  { code: "iul", name: "Indexed Universal Life", category: "life", inPlan: true, enabled: false, sold: false, partners: [], formReady: false, carriers: 1 },
  { code: "medicare_advantage", name: "Medicare Advantage", category: "health", inPlan: true, enabled: true, sold: true, partners: ["Apex Call Center", "Northline Media", "Bluepeak", "Harbor Leads"], formReady: true, carriers: 2 },
  { code: "medicare_supplement", name: "Medicare Supplement", category: "health", inPlan: false, enabled: false, sold: false, partners: [], formReady: true, carriers: 0 },
  { code: "aca", name: "ACA Marketplace", category: "health", inPlan: false, enabled: false, sold: false, partners: [], formReady: false, carriers: 0 },
  { code: "annuity", name: "Fixed Annuity", category: "retirement", inPlan: true, enabled: false, sold: false, partners: [], formReady: true, carriers: 1 },
];

/* ── My profile (profile, languages, sign-in & security, notifications, what you changed) ───── */

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.parse("2026-10-28T16:00:00Z") - days * DAY).toISOString();

const ownProfile = {
  name: "Umar Masood",
  email: "umar.m@powerpolicies.com",
  phone: "+12145550148",
  roleLabel: "Owner",
  workspaceName: "Unlimited Insurance",
  licensedStates: ["AL", "GA", "TX"],
  npn: "19283746",
  licenceNumbers: { TX: "2384761", GA: "LIC-9921" },
  licenceNumbersReady: true,
  avatarVersion: null,
  displayTimezone: null,
};

const notificationEvent = (key: string, label: string, description: string, group: string, opts: { email?: boolean; push?: boolean; digest?: boolean; locked?: string } = {}) => ({
  key, label, description, group, supportsDigest: Boolean(opts.digest), protected: Boolean(opts.locked), protectedReason: opts.locked ?? null,
  delivery: { in_app: true, email: opts.email ?? false, push: opts.push ?? false, digest: opts.digest ? "daily" : "immediate", protected: Boolean(opts.locked) },
});

const notifications = {
  available: true,
  timeZone: "America/Chicago",
  quiet: { enabled: true, start: "21:00", end: "07:00" },
  events: [
    notificationEvent("commission.statement_matched", "Statement matched", "A carrier statement finished matching to policies.", "Money", { email: true, digest: true }),
    notificationEvent("commission.chargeback", "Chargeback recorded", "A carrier took back commission on a policy.", "Money", { email: true, push: true }),
    notificationEvent("retention.at_risk", "Policy at risk", "A policy moved into the at-risk band.", "Retention", { digest: true }),
    notificationEvent("compliance.complaint_due", "Complaint deadline near", "A regulator complaint is due within 48 hours.", "Compliance", { email: true, push: true, locked: "Regulator deadlines always reach the owner." }),
    notificationEvent("acquisition.transfer_waiting", "Live transfer waiting", "A partner's transfer is waiting for an agent.", "Acquisition", { push: true }),
    notificationEvent("account.payment_failed", "Payment failed", "Your card was declined for the subscription.", "Account", { email: true, locked: "Billing problems always reach the owner." }),
  ],
};

const auditEntry = (id: string, sectionKey: string, settingLabel: string, oldValue: string | null, newValue: string | null, days: number, actorName = "Umar Masood") => ({
  id, sectionKey, settingKey: `${sectionKey}.${id}`, settingLabel, oldValue, newValue, changeType: oldValue === null ? "create" : newValue === null ? "delete" : "update",
  actorUserId: "user-umar", actorName, actorRole: "owner", occurredAt: ago(days), source: "ui", reason: null,
});

const history = [
  auditEntry("h1", "products", "Sells Whole Life", "false", "true", 0.2),
  auditEntry("h2", "business-identity", "Trading name", "Unlimited Insurance", "Power Policies", 1),
  auditEntry("h3", "cadence", "Retry after no answer", "4 hours", "2 hours", 3, "Rinor Krasniqi"),
  auditEntry("h4", "calling-windows", "Latest call (agency)", "21:00", "20:00", 6),
  auditEntry("h5", "team-access", "Rosa Patel's role", "Setter", "Licensed agent", 9),
];

/* ── Plan & billing ────────────────────────────────────────────────────────────────────────── */

const billing = (state: PreviewState) => ({
  schemaReady: true,
  subscription: { id: "sub_1", status: "active", statusLabel: "Active", cycle: "monthly", periodStart: ago(12), periodEnd: ago(-18), renewsAt: ago(-18), trialEndsAt: null, pendingPlanName: null, cancelledAt: null },
  plan: {
    id: "plan_advanced", name: "Advanced", priceCents: 44900,
    features: ["Book of business", "Inbound transfers", "Power dialer", "Commission matching", "Retention radar", "Compliance", "Partners", "Accounting"].map((label, index) => ({ key: `f${index}`, label })),
    addons: [{ name: "Custom team access", priceCents: 4900, cycle: "monthly" }],
  },
  limits: [
    { key: "seats", label: "Seats", used: 8, limit: 10, tier: "warning", metered: false, resetsAt: null, hardCap: true },
    { key: "outbound_minutes", label: "Outbound minutes", used: 4120, limit: 10000, tier: "ok", metered: true, resetsAt: ago(-18), hardCap: false },
    { key: "sms", label: "Text messages", used: 1960, limit: 2000, tier: "critical", metered: true, resetsAt: ago(-18), hardCap: true },
    { key: "storage_gb", label: "Document storage (GB)", used: 3, limit: 50, tier: "ok", metered: false, resetsAt: null, hardCap: false },
  ],
  warnPercent: 80,
  invoices: state === "empty" ? [] : [
    { id: "inv_3", number: "INV-2026-0010", status: "issued", totalCents: 49800, periodStart: ago(12), periodEnd: ago(-18), issuedAt: ago(12), dueAt: ago(-2), paidAt: null, payOnlineUrl: "#pay" },
    { id: "inv_2", number: "INV-2026-0009", status: "paid", totalCents: 49800, periodStart: ago(42), periodEnd: ago(12), issuedAt: ago(42), dueAt: ago(28), paidAt: ago(40), payOnlineUrl: null },
    { id: "inv_1", number: "INV-2026-0008", status: "paid", totalCents: 44900, periodStart: ago(72), periodEnd: ago(42), issuedAt: ago(72), dueAt: ago(58), paidAt: ago(70), payOnlineUrl: null },
  ],
  dunning: null,
  retention: { days: 90, endsAt: null },
  actions: { canChangePlan: true, canPause: true, canResume: false, canCancel: true, offerPauseFirst: true },
  cardOnFile: true,
  planChangeBySupport: false,
  options: [
    { id: "plan_basic", name: "Basic", priceCents: 24900, applyNow: false },
    { id: "plan_advanced", name: "Advanced", priceCents: 44900, applyNow: false },
  ],
});

/* ── Team & access (handed to the panel by the server, not fetched) ────────────────────────── */

type Member = TeamSnapshot["members"][number];
const member = (id: string, name: string, email: string, role: Member["role"], extra: Partial<Member> = {}): Member => ({
  id, name, email, role, status: "active", invitedAt: ago(120), acceptedAt: ago(118), lastLoginAt: ago(0.1), lastSeenAt: ago(0.05), licensedStates: [], timezone: null, extraRoles: [], hiddenPages: [], agencyTitle: null, ...extra,
});

export const PREVIEW_TEAM: TeamSnapshot = {
  members: [
    member("user-umar", "Umar Masood", "umar.m@powerpolicies.com", "owner", { licensedStates: ["AL", "GA", "TX"] }),
    member("user-rinor", "Rinor Krasniqi", "rinor@powerpolicies.com", "producer", { licensedStates: ["TX", "FL"], licensedStateExpiries: { FL: ago(-20) }, agencyTitle: "manager" }),
    member("user-rosa", "Rosa Patel", "rosa@powerpolicies.com", "producer", { licensedStates: ["TX"], lastSeenAt: ago(2) }),
    member("user-james", "James Turner", "james@powerpolicies.com", "setter"),
    member("user-lena", "Lena Ortiz", "lena@powerpolicies.com", "bookkeeper", { lastSeenAt: ago(6) }),
    member("user-owen", "Owen Price", "owen@powerpolicies.com", "producer", { status: "invited", acceptedAt: null, lastLoginAt: null, lastSeenAt: null, inviteExpiresAt: ago(-5) }),
  ],
  seats: { used: 6, max: 10, byRole: { owner: 1, producer: 3, assistant: 0, bookkeeper: 1, setter: 1, retention: 0 } },
  bufferSeats: { used: 0, max: 2 },
  outboundLimits: [{ key: "outbound_minutes", label: "Outbound minutes", usage: 4120, limit: 10000, hardCap: false, allowed: true }],
  licensedStatesAvailable: true,
  presenceRecorded: true,
  viewerId: "user-umar",
};

export const PREVIEW_WORKSPACE: WorkspaceSnapshot = {
  tenantId: "tenant-preview",
  tenantName: "Unlimited Insurance",
  createdAt: ago(200),
  planName: "Advanced",
  billingMode: "automatic",
  renewsAt: ago(-18),
  licencesExpiringSoon: 1,
};

/* ── The table ─────────────────────────────────────────────────────────────────────────────── */

const HANDLERS: Record<string, Handler> = {
  ...CARRIER_HANDLERS,
  ...DIALING_HANDLERS,
  ...FORM_HANDLERS,
  ...MONEY_HANDLERS,
  "GET /api/app/agency-profile": (state) => (state === "error" ? failed("the business identity") : ok(agencyProfile(state === "empty"))),
  // Saves answer with the profile as it now stands (the form keeps its own draft).
  "PUT /api/app/agency-profile": (state) => ok({ profile: agencyProfile(state === "empty").profile }),
  "PATCH /api/app/agency-profile": (state) => ok({ profile: agencyProfile(state === "empty").profile }),
  "GET /api/app/settings/products": (state) => (state === "error" ? failed("your products") : ok({ products: state === "empty" ? [] : products })),
  "GET /api/app/profile": (state) => (state === "error" ? failed("your profile") : ok({ profile: ownProfile })),
  "PUT /api/app/profile": () => ok({ profile: ownProfile }),
  "PATCH /api/app/profile": () => ok({ profile: ownProfile }),
  "GET /api/app/profile/languages": (state) => ok({ available: true, languages: state === "empty" ? [] : ["English", "Spanish"] }),
  "PUT /api/app/profile/languages": (_state, body) => ok({ languages: (body as { languages?: string[] } | null)?.languages ?? [] }),
  "GET /api/app/profile/two-factor": () => ok({ enabled: true, enabledAt: ago(40), pending: false, recoveryCodesLeft: 8, required: false, sessionVerified: true }),
  "GET /api/app/profile/sessions": (state) => ok({ sessions: state === "empty" ? [] : [
    { id: "s1", tenantName: "Unlimited Insurance", createdAt: ago(0.3), lastSeenAt: ago(0.01), ip: "203.0.113.24", location: "Dallas, TX", device: "Chrome on Windows", current: true, twoFactor: true },
    { id: "s2", tenantName: "Unlimited Insurance", createdAt: ago(3), lastSeenAt: ago(1), ip: "198.51.100.7", location: "Dallas, TX", device: "Safari on iPhone", current: false, twoFactor: true },
  ] }),
  "GET /api/app/profile/security-events": (state) => ok({ events: state === "empty" ? [] : [
    { id: "e1", type: "signed_in", label: "Signed in", at: ago(0.3), ip: "203.0.113.24" },
    { id: "e2", type: "password_changed", label: "Password changed", at: ago(12), ip: "203.0.113.24" },
    { id: "e3", type: "two_factor_enabled", label: "Two-step verification turned on", at: ago(40), ip: "203.0.113.24" },
  ] }),
  "GET /api/app/notification-preferences": (state) => (state === "error" ? failed("your notification preferences") : ok(notifications)),
  "PUT /api/app/notification-preferences": () => ok(notifications),
  "GET /api/app/settings-audit": (state) => (state === "error" ? failed("the settings history") : ok({ entries: state === "empty" ? [] : history, actors: [{ id: "user-umar", name: "Umar Masood" }, { id: "user-rinor", name: "Rinor Krasniqi" }] })),
  "GET /api/app/settings-audit/last": () => ok({ last: history[0] }),
  "GET /api/app/billing": (state) => (state === "error" ? failed("your plan and billing") : ok(billing(state))),
  "PATCH /api/app/settings/products": (_state, body) => {
    const change = body as { product_code?: string; sold?: boolean } | null;
    // As the server does: sold = in the plan and switched on (lib/products/settingsView.ts).
    products = products.map((row) => (row.code === change?.product_code ? { ...row, enabled: Boolean(change?.sold), sold: row.inPlan && Boolean(change?.sold) } : row));
    return ok({ products });
  },
};

/** Sections whose real panel renders in the preview (their fixtures are above). */
export const PREVIEW_SECTIONS = new Set([
  "my-profile", "business-identity", "products", "team-access", "billing", "settings-history", "carriers",
  "pipelines", "form-templates", "lead-posting", "calendar", "cadence", "queue-sla", "calling-windows", "integrations",
  // The Sales panels carry their own sample mode (?preview=sample, components/app/settings/sales/shared.tsx).
  "sales-underwriting", "sales-quotation", "sales-field-sets", "sales-disclosures", "sales-preferences",
  "sales-welcome-pack", "sales-ai", "sales-pipeline-sync", "sales-extension",
]);

/** The sample answer for a request, or null when the preview has none (the request then goes out as usual). */
export function previewAnswer(method: string, path: string, state: PreviewState, body: unknown): Answer | null {
  const key = `${method.toUpperCase()} ${path}`;
  const handler = HANDLERS[key];
  if (handler) return handler(state, body);
  // Keys with ":name" segments (the Partners pages' /api/app/partners/:id/...), matched segment by segment.
  for (const [pattern, run] of Object.entries(PARTNER_HANDLERS)) {
    const want = pattern.split(/[ /]/);
    const got = key.split(/[ /]/);
    if (want.length !== got.length) continue;
    const params: Record<string, string> = {};
    if (want.every((part, index) => (part.startsWith(":") ? ((params[part.slice(1)] = got[index]), true) : part === got[index]))) return run(state, body, params);
  }
  return null;
}

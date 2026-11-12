import type { DashViewProps } from "../../../components/app/home/views/view-props.ts";
import { firstOpenable } from "../roleHome.ts";
import { REASON_LABELS, STEP_SLUG, type Reason, type Step } from "../../retention/cases/ladder.ts";
import { caseScorecard, rateText, type ScoreLine } from "../../retention/cases/scorecard.ts";

/**
 * The dashboard's Retention view (owner 2026-11-06, /app/dashboard?view=retention): what the ladder, Waiting on
 * the carrier and Win-back hold for this reader, read the way those pages read them (the same stores, the same
 * role and AG-0.5 scope rules), shaped here for the dash kit.
 *
 * Server only: every database read is a dynamic import of a `server-only` module inside `loadRetentionView`,
 * so this file's shaping stays pure and testable under node (retention.test.mjs) with relative imports only.
 * The dashboard never writes: it does not refresh the cases (ensureCasesFresh), verify servicing requests or
 * release win-backs as their pages do on opening; it reads what those last left.
 *
 * A read that fails is null and its card is left out; nothing is ever shown that no table holds.
 */

/** The scorecard's "Last 6 months" (lib/retention/scorecard SCORECARD_PERIODS["180"]), so the ring matches its page. */
export const SCORE_DAYS = 182;
export const SCORE_PERIOD = "180";
/** How long a closed case stays on Cases › Closed (lib/retention/cases/ladder CLOSED_DAYS). */
export const CLOSED_TAB_DAYS = 90;
export const CHART_MONTHS = 6;

/** The fields of a hydrated case (lib/retention/cases/store CaseRow) this view uses. */
export type CaseLite = {
  id: string; clientName: string | null; carrierId: string; carrierName: string; policyNumber: string;
  step: Step; reason: Reason; status: string; deadline: string | null; daysLeft: number | null;
  monthlyCents: number | null; resolvedAt: string | null; ownerId: string | null; unreachable: boolean;
};

const OPEN = new Set(["open", "working", "waiting_on_carrier"]);
export const isOpen = (c: Pick<CaseLite, "status">) => OPEN.has(c.status);

/** The calendar day of an instant in a zone (YYYY-MM-DD); UTC when the zone is not one Intl knows. */
export function dayIn(at: number | string, zone: string): string {
  const ms = typeof at === "number" ? at : Date.parse(at);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The last `count` calendar months up to and including today's, oldest first. */
export function monthKeys(today: string, count: number): Array<{ key: string; label: string; start: string }> {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: count }, (_, i) => {
    const total = year * 12 + month - (count - 1 - i);
    const y = Math.floor(total / 12);
    const m = total % 12;
    const key = `${y}-${String(m + 1).padStart(2, "0")}`;
    return { key, label: MONTH_NAMES[m], start: `${key}-01` };
  });
}

export type MonthPoint = { key: string; label: string; start: string; savedCents: number; lostCents: number; saved: number; lost: number };
export type ReasonBar = { reason: Reason; label: string; step: Step; count: number };

export type CaseShape = {
  open: number;
  /** Open cases past their carrier deadline: Cases `?deadline=over`. */
  pastDue: number;
  /** Open paperwork cases on a mailed bill: Cases `?step=paperwork&reason=mailed_bill`. */
  mailedBills: number;
  byReason: ReasonBar[];
  closingSoon: CaseLite[];
  months: MonthPoint[];
  thisMonth: { saved: number; savedCents: number; lost: number };
  score: ScoreLine;
  /** Saved and lost cases, newest first. */
  recent: CaseLite[];
};

/**
 * The cases as the view draws them. `cases` is the scorecard's read (open now, or closed in the last
 * SCORE_DAYS), already narrowed to this reader; `today` is the agency's calendar day.
 */
export function shapeCases(cases: readonly CaseLite[], today: string, zone: string): CaseShape {
  const open = cases.filter(isOpen);
  const reasons = new Map<Reason, ReasonBar>();
  for (const c of open) {
    const bar = reasons.get(c.reason) ?? { reason: c.reason, label: REASON_LABELS[c.reason] ?? c.reason, step: c.step, count: 0 };
    bar.count++;
    reasons.set(c.reason, bar);
  }
  const months = monthKeys(today, CHART_MONTHS).map((m): MonthPoint => ({ ...m, savedCents: 0, lostCents: 0, saved: 0, lost: 0 }));
  const monthOf = new Map(months.map((m) => [m.key, m]));
  const closed = cases.filter((c) => (c.status === "saved" || c.status === "lost") && c.resolvedAt);
  for (const c of closed) {
    const point = monthOf.get(dayIn(c.resolvedAt!, zone).slice(0, 7));
    if (!point) continue;
    if (c.status === "saved") { point.saved++; point.savedCents += c.monthlyCents ?? 0; }
    else { point.lost++; point.lostCents += c.monthlyCents ?? 0; }
  }
  const current = months[months.length - 1];
  return {
    open: open.length,
    pastDue: open.filter((c) => c.daysLeft !== null && c.daysLeft < 0).length,
    mailedBills: open.filter((c) => c.step === "paperwork" && c.reason === "mailed_bill").length,
    byReason: [...reasons.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    closingSoon: open.filter((c) => c.step !== "lost" && c.step !== "paperwork" && c.daysLeft !== null && c.daysLeft >= 0)
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || (b.monthlyCents ?? 0) - (a.monthlyCents ?? 0)).slice(0, 5),
    months,
    thisMonth: { saved: current.saved, savedCents: current.savedCents, lost: current.lost },
    score: caseScorecard(cases.map((c) => ({ ownerId: c.ownerId, step: c.step, status: c.status, unreachable: c.unreachable, monthlyCents: c.monthlyCents ?? 0 }))).total,
    recent: [...closed].sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "")),
  };
}

export { rateText };

/** Waiting on the carrier's "Check it" bucket (components/app/servicing-board bucketOf): sent, and the file does not show it. */
export function servicingNeedsCheck(r: { status: string; unprovable: readonly string[] | null; expectedEffectiveDate: string | null }, today: string): boolean {
  if (r.status !== "submitted" && r.status !== "awaiting_carrier" && r.status !== "confirmed_by_carrier") return false;
  return r.status === "confirmed_by_carrier" || (r.unprovable?.length ?? 0) > 0 || (r.expectedEffectiveDate !== null && r.expectedEffectiveDate < today);
}

/**
 * Win-back's "On the Win-back list" (components/app/winback-board stageOf "released"), plus a client whose
 * cooling-off is over and whom the page releases when it next opens (lib/retention/winback isDue).
 */
export function winbackReady(c: { band: string; releasedAt: string | null; eligibleFrom: string | null; blockedReason: string | null }, today: string): boolean {
  if (c.band === "never") return false;
  if (c.releasedAt) return true;
  return !c.blockedReason && c.eligibleFrom !== null && c.eligibleFrom <= today;
}

/** The Cases page's address for one step, reason or deadline group (components/app/retention/ladder-board). */
export function casesHref(base: string, filters: { step?: Step | "closed"; reason?: Reason; deadline?: "over" | "week" | "later" | "none" }): string {
  const params = new URLSearchParams();
  if (filters.step) params.set("step", filters.step === "closed" ? "closed" : STEP_SLUG[filters.step]);
  if (filters.reason) params.set("reason", filters.reason);
  if (filters.deadline) params.set("deadline", filters.deadline);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** Where a month of the chart opens: Cases › Closed while the month is on it (90 days), else the scorecard. */
export function monthHref(monthStart: string, today: string, links: { cases: string | null; scorecard: string | null }): string | null {
  const closedFrom = new Date(Date.parse(`${today}T00:00:00Z`) - CLOSED_TAB_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (links.cases && nextMonthStart(monthStart) > closedFrom) return casesHref(links.cases, { step: "closed" });
  return links.scorecard ? `${links.scorecard}?period=${SCORE_PERIOD}` : links.cases ? casesHref(links.cases, { step: "closed" }) : null;
}
const nextMonthStart = (start: string) => {
  const total = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7));
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
};

/* ── The read ───────────────────────────────────────────────────────────────────────────────── */

export type ServicingLite = { id: string; clientName: string | null; carrierName: string; policyNumber: string; verifiedAt: string };

export type RetentionViewData = {
  today: string;
  links: { cases: string | null; servicing: string | null; winback: string | null; scorecard: string | null; persistency: string | null };
  cases: CaseShape | null;
  servicing: { overdue: number; confirmations: ServicingLite[] } | null;
  winback: { ready: number; claims: number } | null;
  /** The unearned advance still on the saved cases' policies: the chargeback each save kept off. null: no money, or not read. */
  advanceKept: { cents: number; policies: number } | null;
  persistency13: { text: string; alive: number; eligible: number } | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const CHUNK = 200;
const chunked = <T,>(items: readonly T[]) => Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, i * CHUNK + CHUNK));
const keyOf = (carrierId: string, policyNumber: string) => `${carrierId}|${policyNumber}`;

/** Pages linked under a role or scope rule, as data (lib/menu: no menu key in a conditional). */
const RETENTION_PAGES = {
  winback: ["retention.winback"],
  persistency: ["insight.book-scorecards"],
} as const;

export async function loadRetentionView(props: DashViewProps): Promise<RetentionViewData> {
  const { context, available, scope, solo, zone, now, noMoney } = props;
  const role = context.role;
  const open = (keys: readonly string[]) => firstOpenable(keys, available, role, solo);
  const links = {
    cases: open(["retention.save-queue"]),
    servicing: open(["retention.payment-repair"]),
    // A retention rep has no win-back calls (LA-5.8): the page sends them to Cases › Lapsed.
    winback: role === "retention" ? null : open(RETENTION_PAGES.winback),
    scorecard: open(["retention.scorecard"]),
    // As the home's money figure (lib/dashboard/money): the book is narrowed only for a producer.
    persistency: scope === null || role === "producer" ? open(RETENTION_PAGES.persistency) : null,
  };
  const today = dayIn(now, zone);
  const viewer = { tenantId: context.tenantId, userId: context.userId, role, scope };
  const safe = <T,>(label: string, read: () => Promise<T>): Promise<T | null> => read().catch((error: unknown) => { console.error(`[dashboard retention] ${label}`, error); return null; });

  const [rawCases, servicing, winback, persistency13] = await Promise.all([
    links.cases ? safe("cases", async () => {
      const { loadScoreCases } = await import("@/lib/retention/cases/store");
      return (await loadScoreCases(viewer, SCORE_DAYS))?.cases ?? null;
    }) : null,
    links.servicing ? safe("servicing", () => readServicing(viewer, today)) : null,
    links.winback ? safe("win-back", () => readWinback(viewer, today)) : null,
    links.persistency ? safe("persistency", () => readPersistency(context)) : null,
  ]);
  const cases = rawCases ? shapeCases(rawCases, today, zone) : null;
  // Chargebacks avoided is a figure of the Retention view only; the Overview does not read it.
  const advanceKept = !noMoney && !props.forOverview && rawCases ? await safe("advance kept", () => readAdvanceKept(context.tenantId, rawCases.filter((c) => c.status === "saved"))) : null;
  return { today, links, cases, servicing, winback, advanceKept, persistency13 };
}

type Viewer = { tenantId: string; userId: string; role: string; scope: DashViewProps["scope"] };

/** The policies (carrier|number) this reader may see among `numbers`: a producer his own, a narrowed session its producers'. */
async function visiblePolicies(db: Loose, viewer: Viewer, numbers: string[], owners: readonly string[] | null): Promise<Set<string> | null> {
  if (owners === null) return null;
  const { scopeQuery } = await import("@/lib/agency/visibility");
  const out = new Set<string>();
  await Promise.all(chunked([...new Set(numbers)]).map(async (part) => {
    const { data, error } = await scopeQuery(db.from("policy_current").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId), "agent_user_id", owners).in("policy_number", part);
    if (error) throw error;
    for (const p of (data ?? []) as Loose[]) out.add(keyOf(p.carrier_id, p.policy_number));
  }));
  return out;
}

/** Who a reader's retention covers, as Waiting on the carrier and Win-back narrow it. */
const ownersOf = (viewer: Viewer): readonly string[] | null => (viewer.scope !== null ? viewer.scope : viewer.role === "producer" ? [viewer.userId] : null);

/** Waiting on the carrier, read only (the page's own loader also runs the file check, a write). */
async function readServicing(viewer: Viewer, today: string): Promise<RetentionViewData["servicing"]> {
  const { getSupabaseServiceClient } = await import("@/lib/supabase/service");
  const db: Loose = getSupabaseServiceClient();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString();
  const [waiting, proven] = await Promise.all([
    db.from("servicing_request").select("id, carrier_id, policy_number, status, unprovable_fields, expected_effective_date").eq("tenant_id", viewer.tenantId).in("status", ["submitted", "awaiting_carrier", "confirmed_by_carrier"]).limit(1000),
    db.from("servicing_request").select("id, carrier_id, policy_number, contact_id, verified_at").eq("tenant_id", viewer.tenantId).eq("status", "verified_in_file").gte("verified_at", since).order("verified_at", { ascending: false }).limit(200),
  ]);
  if (waiting.error) throw waiting.error;
  if (proven.error) throw proven.error;
  const visible = await visiblePolicies(db, viewer, [...(waiting.data ?? []), ...(proven.data ?? [])].map((r: Loose) => r.policy_number), ownersOf(viewer));
  const seen = (r: Loose) => !visible || visible.has(keyOf(r.carrier_id, r.policy_number));
  const overdue = ((waiting.data ?? []) as Loose[]).filter(seen).filter((r) => servicingNeedsCheck({ status: r.status, unprovable: r.unprovable_fields ?? [], expectedEffectiveDate: r.expected_effective_date ?? null }, today)).length;
  const latest = ((proven.data ?? []) as Loose[]).filter(seen).slice(0, 6);
  const contactIds = [...new Set(latest.map((r) => r.contact_id).filter(Boolean))] as string[];
  const [contacts, carriers] = await Promise.all([
    contactIds.length ? db.from("contacts").select("id, first_name, last_name").eq("tenant_id", viewer.tenantId).in("id", contactIds) : { data: [] },
    latest.length ? db.from("carriers").select("id, name").in("id", [...new Set(latest.map((r) => r.carrier_id))]) : { data: [] },
  ]);
  const nameOf = new Map<string, string>(((contacts.data ?? []) as Loose[]).map((c) => [c.id, [c.first_name, c.last_name].filter(Boolean).join(" ")]));
  const carrierOf = new Map<string, string>(((carriers.data ?? []) as Loose[]).map((c) => [c.id, c.name]));
  return {
    overdue,
    confirmations: latest.map((r) => ({ id: r.id, clientName: (r.contact_id && nameOf.get(r.contact_id)) || null, carrierName: carrierOf.get(r.carrier_id) ?? "Carrier not known", policyNumber: r.policy_number, verifiedAt: r.verified_at })),
  };
}

/** Win-back, read only (the page's own loader also classifies and releases, both writes). */
async function readWinback(viewer: Viewer, today: string): Promise<RetentionViewData["winback"]> {
  const { getSupabaseServiceClient } = await import("@/lib/supabase/service");
  const db: Loose = getSupabaseServiceClient();
  const [candidates, claims] = await Promise.all([
    db.from("winback_candidate").select("carrier_id, source_policy_number, winback_band, eligible_from, released_to_nurture_at, release_blocked_reason").eq("tenant_id", viewer.tenantId).neq("winback_band", "never").limit(5000),
    db.from("household_claim_followup").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId).is("resolved_at", null).limit(1000),
  ]);
  if (candidates.error) throw candidates.error;
  if (claims.error) throw claims.error;
  const visible = await visiblePolicies(db, viewer, [...((candidates.data ?? []) as Loose[]).map((r) => r.source_policy_number), ...((claims.data ?? []) as Loose[]).map((c) => c.policy_number)], ownersOf(viewer));
  const ready = ((candidates.data ?? []) as Loose[])
    .filter((r) => !visible || visible.has(keyOf(r.carrier_id, r.source_policy_number)))
    // The page treats a blocked reason "Releasing since …" as no reason (a release in flight).
    .filter((r) => winbackReady({ band: r.winback_band, releasedAt: r.released_to_nurture_at, eligibleFrom: r.eligible_from, blockedReason: String(r.release_blocked_reason ?? "").startsWith("Releasing since ") ? null : r.release_blocked_reason }, today)).length;
  return { ready, claims: ((claims.data ?? []) as Loose[]).filter((c) => !visible || visible.has(keyOf(c.carrier_id, c.policy_number))).length };
}

/** The unearned advance on the saved cases' policies (lib/ingestion/retentionStore advanceAtRisk, the ladder's own figure). */
async function readAdvanceKept(tenantId: string, saved: readonly CaseLite[]): Promise<RetentionViewData["advanceKept"]> {
  if (!saved.length) return { cents: 0, policies: 0 };
  const [{ getSupabaseServiceClient }, { advanceAtRisk }] = await Promise.all([import("@/lib/supabase/service"), import("@/lib/ingestion/retentionStore")]);
  const db: Loose = getSupabaseServiceClient();
  const savedNumbers = [...new Set(saved.map((c) => c.policyNumber))];
  const parts = await Promise.all(chunked(savedNumbers).map((part) => db.from("policy_current").select("carrier_id, policy_number, months_paid, product_code, as_of").eq("tenant_id", tenantId).in("policy_number", part)));
  const policies: Loose[] = [];
  for (const part of parts as Loose[]) {
    if (part.error) throw part.error;
    policies.push(...(part.data ?? []));
  }
  const savedKeys = new Set(saved.map((c) => keyOf(c.carrierId, c.policyNumber)));
  const mine = policies.filter((p) => savedKeys.has(keyOf(p.carrier_id, p.policy_number)));
  const atRisk = await advanceAtRisk(tenantId, mine);
  let cents = 0;
  let counted = 0;
  for (const value of atRisk.values()) if (value !== null && value > 0) { cents += value; counted++; }
  return { cents, policies: counted };
}

/** Book scorecards' month-13 persistency, as the home reads month 9 (lib/dashboard/money). */
export async function readPersistency(context: DashViewProps["context"]): Promise<RetentionViewData["persistency13"]> {
  const [{ loadScorecards }, { historyStart, persistency, persistencyText }, { addMonths }] = await Promise.all([
    import("@/lib/ingestion/scorecardsStore"), import("@/lib/ingestion/scorecards"), import("@/lib/ledger/compute"),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const data = await loadScorecards(context, { from: addMonths(today, -12), to: today });
  if (!data.available) return null;
  const cell = persistency(data.policies, 13, data.today, historyStart(data.policies));
  if (cell.building || !cell.eligible) return null;
  return { text: persistencyText(cell, "count", data.minSample), alive: cell.alive, eligible: cell.eligible };
}

import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { listComplaints } from "@/lib/compliance/complaintStore";
import { listDeletionRequests } from "@/lib/compliance/dataSubjectStore";
import { getConsentEvidence } from "@/lib/consent/evidenceService";
import { suppressionOverview } from "@/lib/suppression/overview";
import type { DashViewProps } from "@/components/app/home/views/view-props";

import { firstOpenable } from "../roleHome.ts";
import { lastDays, type DayWindow } from "../todayMath.ts";
import { dayMonth, clockTime, zonedParts } from "../../format/dates.ts";

/**
 * The dashboard's Compliance view (owner 2026-11-06, /app/dashboard?view=compliance): am I safe to dial,
 * what waits on me, and what happened lately — each figure read from the module that owns it, the same
 * cheap reads its own page makes. Nothing scans the book here: the gap scan (compliance_gaps) stays on
 * /app/compliance and /app/evidence-report.
 *
 *   screening   screening_audit this month (tenant_id, ts index), counted exactly first; the per-day
 *               chart is drawn only when every row of the month could be read (never a truncated line)
 *   consent     the consent locker's own head counts (getConsentEvidence tiles)
 *   feeds       suppressionOverview: the DNC / litigator feeds the dialer gates on
 *   complaints  listComplaints, deletions listDeletionRequests (what the Compliance rail counts)
 *   licences    licenses + appointments expiring within 30 days
 *
 * A read that fails is null and its card is left out; nothing is ever shown as zero for want of a read.
 * Inside an agency a narrow session (AG-0.5) is refused by every compliance page but Licences &
 * appointments, so only that survives for it.
 */

/* ── Pure shaping (tested in compliance.test.mjs) ─────────────────────────────────────────────── */

export const BLOCKED_OUTCOMES = ["dnc", "tcpa_litigator", "internal_dq", "invalid_phone"] as const;
export type BlockedOutcome = (typeof BLOCKED_OUTCOMES)[number];
export const BLOCKED_LABELS: Record<BlockedOutcome, string> = {
  dnc: "On a Do Not Call registry",
  tcpa_litigator: "Known TCPA litigator",
  internal_dq: "Asked us not to call",
  invalid_phone: "Not a working number",
};
const isBlocked = (outcome: string): outcome is BlockedOutcome => (BLOCKED_OUTCOMES as readonly string[]).includes(outcome);

export type ScreenRow = { ts: string; outcome: string; phone_digits?: string | null; lead_id?: string | null };
export type DayPoint = { key: string; label: string; value: number };

/** Screened and blocked per agency day, the month's blocked by reason, and today's blocked. */
export function screeningByDay(rows: readonly ScreenRow[], days: readonly DayWindow[]) {
  const screened = days.map((day) => ({ key: day.key, label: day.label, value: 0 }));
  const blocked = days.map((day) => ({ key: day.key, label: day.label, value: 0 }));
  const byReason: Record<BlockedOutcome, number> = { dnc: 0, tcpa_litigator: 0, internal_dq: 0, invalid_phone: 0 };
  const bounds = days.map((day) => [Date.parse(day.start), Date.parse(day.end)] as const);
  let total = 0;
  let totalBlocked = 0;
  for (const row of rows) {
    const at = Date.parse(row.ts);
    const index = bounds.findIndex(([start, end]) => at >= start && at < end);
    if (index < 0) continue;
    total += 1;
    screened[index].value += 1;
    if (isBlocked(row.outcome)) {
      totalBlocked += 1;
      blocked[index].value += 1;
      byReason[row.outcome] += 1;
    }
  }
  const todayIndex = days.findIndex((day) => day.isToday);
  return { screened, blocked, byReason, total, totalBlocked, blockedToday: todayIndex >= 0 ? blocked[todayIndex].value : 0 };
}

/** The reasons as bars, largest first; the order of the list breaks ties so it never jumps. */
export function reasonBars(byReason: Record<BlockedOutcome, number>) {
  return BLOCKED_OUTCOMES.map((key, order) => ({ key, label: BLOCKED_LABELS[key], value: byReason[key] ?? 0, order }))
    .sort((a, b) => b.value - a.value || a.order - b.order)
    .map(({ key, label, value }) => ({ key, label, value, tone: (key === "tcpa_litigator" ? "danger" : key === "invalid_phone" ? "neutral" : "warning") as "danger" | "warning" | "neutral" }));
}

export type ConsentTiles = { leads: number; full: number; noIp: number; textMissing: number };

/** Consent on file: leads holding the words they agreed to, of every lead. */
export function consentShare(tiles: ConsentTiles) {
  const withText = tiles.full + tiles.noIp;
  const pct = tiles.leads > 0 ? Math.round((withText * 100) / tiles.leads) : null;
  return { withText, withIp: tiles.full, gaps: tiles.textMissing, leads: tiles.leads, pct, tone: (pct === null || pct >= 90 ? "primary" : pct >= 70 ? "warning" : "danger") as "primary" | "warning" | "danger" };
}

export type Feed = { name: string; type: string; typeLabel: string; state: "fresh" | "failing" | "no_calls" };

/**
 * The dialing state: "Safe to dial" only when every DNC and litigator feed answered and the dialer is not
 * refusing every dial; otherwise what is failing. Demo screening is said as such, never as safe.
 */
export function dialingState(input: { feeds: readonly Feed[]; dialingBlocked: boolean; demo: boolean }) {
  const gating = input.feeds.filter((feed) => feed.type === "dnc_scrub" || feed.type === "litigator_scrub");
  const failing = gating.filter((feed) => feed.state === "failing");
  const quiet = gating.filter((feed) => feed.state === "no_calls");
  if (input.demo) return { safe: false, failing: 0, value: "Demo screening", line: "Every lookup is answered locally, not by the live feeds." };
  if (input.dialingBlocked) {
    const line = gating.filter((feed) => feed.type === "dnc_scrub").length === 0 ? "No DNC feed is switched on, so the dialer refuses every dial." : "Every DNC feed is failing, so the dialer refuses every dial.";
    return { safe: false, failing: failing.length, value: "Dialing blocked", line };
  }
  if (failing.length) return { safe: false, failing: failing.length, value: failing.length === 1 ? "1 feed failing" : `${failing.length} feeds failing`, line: `Not answering: ${failing.map((feed) => `${feed.name} (${feed.typeLabel})`).join(", ")}` };
  return {
    safe: true,
    failing: 0,
    value: "Safe to dial",
    line: quiet.length ? `Every DNC and litigator feed is up; ${quiet.length === 1 ? "1 had" : `${quiet.length} had`} no checks in 24 hours.` : "Every DNC and litigator feed answered in the last 24 hours.",
  };
}

const DAY_MS = 86_400_000;
/** Whole calendar days from today to a date (negative once past), date to date. */
export function daysUntil(date: string, nowMs: number): number {
  const today = Date.parse(`${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - today) / DAY_MS);
}

export function dueText(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} late`;
  if (days === 0) return "Today";
  return `In ${days} day${days === 1 ? "" : "s"}`;
}

export type DeadlineRow = { key: string; what: string; who: string; due: string; dueAt: number; href: string };
/** Every dated deadline, soonest first (an undated regulator complaint sits on top: its deadline is the problem). */
export function sortDeadlines(rows: readonly DeadlineRow[], limit = 6): DeadlineRow[] {
  return [...rows].sort((a, b) => a.dueAt - b.dueAt || a.key.localeCompare(b.key)).slice(0, limit);
}

export type EventRow = { key: string; at: string; mark: string; tone: "danger" | "warning" | "good" | "info" | "neutral"; title: string; detail?: string; href: string };
/** The newest events of every kind, merged. */
export function newestEvents(rows: readonly EventRow[], limit = 6): EventRow[] {
  return [...rows].filter((row) => Number.isFinite(Date.parse(row.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key)).slice(0, limit);
}

/** "14:05" when it was today in the agency, else "3 Nov". */
export function whenText(at: string, nowMs: number, zone: string): string {
  return dayMonth(at, zone) === dayMonth(nowMs, zone) ? clockTime(at, zone) : dayMonth(at, zone);
}

export const maskPhone = (digits: string | null | undefined) => (digits && digits.length >= 4 ? `ending ${digits.slice(-4)}` : "number withheld");

/* ── The reads ────────────────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
const quiet = <T,>(promise: PromiseLike<T>): Promise<T | null> => Promise.resolve(promise).catch((error: unknown) => {
  console.error("[dashboard:compliance]", error instanceof Error ? error.message : error);
  return null;
});
const rowsOf = <T,>(result: { data: unknown; error: { message: string } | null }): T[] => {
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as T[];
};

/** The month's screening rows hold at most this many before the chart is left out rather than drawn short. */
const SCREEN_PAGE = 1000;
const SCREEN_CAP = 10_000;

async function monthScreening(tenantId: string, since: string): Promise<ScreenRow[] | null> {
  const counted = await db().from("screening_audit").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gte("ts", since);
  if (counted.error || typeof counted.count !== "number") throw new Error(counted.error?.message ?? "no count");
  if (counted.count > SCREEN_CAP) return null;
  const pages = Math.ceil(counted.count / SCREEN_PAGE);
  const reads = await Promise.all(Array.from({ length: pages }, (_, page) =>
    db().from("screening_audit").select("id, ts, outcome, phone_digits, lead_id").eq("tenant_id", tenantId).gte("ts", since)
      .order("ts", { ascending: false }).order("id", { ascending: false }).range(page * SCREEN_PAGE, page * SCREEN_PAGE + SCREEN_PAGE - 1)));
  const rows = reads.flatMap((read) => rowsOf<ScreenRow>(read));
  // Rows written between the count and the reads can push one off a page edge; short means unreliable.
  if (rows.length < counted.count) return null;
  return rows;
}

type ArtefactRow = { id: string; provider: string | null; capture_status: string | null; captured_at: string };
type Expiring = { key: string; kind: "licence" | "appointment"; label: string; expiresAt: string };

async function expiringRecords(tenantId: string, untilDate: string): Promise<Expiring[]> {
  const [licences, appointments] = await Promise.all([
    db().from("licenses").select("id, state, expires_at").eq("tenant_id", tenantId).lte("expires_at", untilDate),
    // expires_at arrives with 20260924310000: before it no appointment can expire, so none is listed.
    db().from("appointments").select("id, carrier_id, state, status, expires_at").eq("tenant_id", tenantId).neq("status", "terminated").not("expires_at", "is", null).lte("expires_at", untilDate),
  ]);
  const out: Expiring[] = rowsOf<{ id: string; state: string; expires_at: string }>(licences).map((row) => ({ key: `licence_${row.id}`, kind: "licence", label: `${row.state} licence`, expiresAt: row.expires_at }));
  if (!appointments.error) {
    const rows = (appointments.data ?? []) as Array<{ id: string; carrier_id: string; state: string; expires_at: string }>;
    const ids = [...new Set(rows.map((row) => row.carrier_id).filter(Boolean))];
    const carriers = ids.length ? await db().from("carriers").select("id, name").in("id", ids) : { data: [], error: null };
    const names = new Map(((carriers.error ? [] : carriers.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
    for (const row of rows) out.push({ key: `appointment_${row.id}`, kind: "appointment", label: `${names.get(row.carrier_id) ?? "Carrier"} appointment · ${row.state}`, expiresAt: row.expires_at });
  }
  return out;
}

/** The pages this view reads and links, as data (lib/menu: no menu key in a conditional). `narrowOk`: the page
 *  also serves a narrowed agency session (AG-0.5). */
const COMPLIANCE_PAGES = {
  complaints: { key: "compliance.complaints", narrowOk: false },
  deletions: { key: "compliance.deletions", narrowOk: false },
  consent: { key: "compliance.consent", narrowOk: false },
  tcpa: { key: "compliance.tcpa", narrowOk: false },
  appointments: { key: "book.appointments", narrowOk: true },
  leads: { key: "leads.workspace", narrowOk: false },
} as const;

export async function loadComplianceView(props: DashViewProps) {
  const { context, available, scope, solo, zone, now } = props;
  const { tenantId, userId, role } = context;
  const viewer = { tenantId, userId, role };
  // A narrow agency session is refused by every compliance page but Licences & appointments (AG-0.5).
  const opens = (page: (typeof COMPLIANCE_PAGES)[keyof typeof COMPLIANCE_PAGES]) => (scope === null || page.narrowOk) && firstOpenable([page.key], available, role, solo) !== null;
  const can = {
    complaints: opens(COMPLIANCE_PAGES.complaints),
    deletions: opens(COMPLIANCE_PAGES.deletions),
    consent: opens(COMPLIANCE_PAGES.consent),
    tcpa: opens(COMPLIANCE_PAGES.tcpa),
    appointments: opens(COMPLIANCE_PAGES.appointments),
    leads: opens(COMPLIANCE_PAGES.leads),
  };

  // This month, the agency's month: its first day to today.
  const days = lastDays(now, zone, zonedParts(now, zone)?.day ?? new Date(now).getUTCDate());
  const monthStart = days[0].start;
  const until = new Date(now + 30 * DAY_MS).toISOString().slice(0, 10);

  const [screening, lastCheck, overview, consent, complaints, deletions, expiring, artefacts] = await Promise.all([
    can.tcpa ? quiet(monthScreening(tenantId, monthStart)) : null,
    can.tcpa ? quiet<string | null>(db().from("screening_audit").select("ts").eq("tenant_id", tenantId).order("ts", { ascending: false }).limit(1).then((read: Loose) => rowsOf<{ ts: string }>(read)[0]?.ts ?? null)) : null,
    can.tcpa ? quiet(suppressionOverview(tenantId)) : null,
    can.consent ? quiet(getConsentEvidence({ tenantId, filter: "every", sources: [], page: 0, pageSize: 1 }).then((view) => view.tiles)) : null,
    can.complaints ? quiet(listComplaints(viewer)) : null,
    can.deletions ? quiet(listDeletionRequests(viewer)) : null,
    can.appointments ? quiet(expiringRecords(tenantId, until)) : null,
    can.consent ? quiet<ArtefactRow[]>(db().from("tenant_consent_artefacts").select("id, provider, capture_status, captured_at").eq("tenant_id", tenantId).order("captured_at", { ascending: false }).limit(5).then((read: Loose) => rowsOf<ArtefactRow>(read))) : null,
  ]);

  const openComplaints = complaints ? complaints.filter((row) => row.status !== "resolved") : null;
  const nowDate = new Date(now);
  const holdOver = (at: string | null) => Boolean(at && Date.parse(at) <= now);

  return {
    can,
    days,
    screening: screening ? screeningByDay(screening, days) : null,
    recentBlocked: screening ? screening.filter((row) => isBlocked(row.outcome)).slice(0, 5) : null,
    lastCheck,
    overview,
    consent,
    complaints: openComplaints,
    receivedComplaints: complaints ? complaints.slice().sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt)).slice(0, 5) : null,
    deletions: deletions
      ? {
          all: deletions,
          toVerify: deletions.filter((row) => row.status === "received" || row.status === "verifying").length,
          ready: deletions.filter((row) => row.status === "scheduled" && holdOver(row.scheduledPurgeAt)).length,
        }
      : null,
    expiring,
    artefacts,
    now: nowDate,
  };
}

export type ComplianceViewData = Awaited<ReturnType<typeof loadComplianceView>>;

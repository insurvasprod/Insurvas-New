import "server-only";

import { cache } from "react";

import { readPlatformState } from "@/lib/adminAlerts/service";
import { fetchUsersListStats } from "@/lib/adminUsersList/directory";
import { fetchLoginActivityStats } from "@/lib/loginEvents/queries";
import { fetchFunnel, fetchMetrics, fetchSnapshotFreshness, type FunnelStep } from "@/lib/metrics/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { fetchTrials } from "@/lib/trials/queries";

/**
 * The reads behind the admin dashboard's Overview, Money and Customers tabs (admin round 1). Each is
 * wrapped in React's per-request `cache`, so two cards on one tab that need the same rows read them once,
 * while each card still awaits (and fails) on its own. Every read throws on a database error: a failed
 * query drawn as an empty graph would read as "nothing happened", which is the one thing a dashboard must
 * never say by accident. The card catches it and says it could not load.
 *
 * Read-only, all of it.
 */

const db = () => getSupabaseServiceClient();
const DAY_MS = 86_400_000;

type CountResult = { count: number | null; error: { message: string } | null };
function counted(result: CountResult, label: string): number {
  if (result.error) throw new Error(`Could not load ${label}: ${result.error.message}`);
  return result.count ?? 0;
}

/** The request's clock, read once, so every card on a tab draws the same periods. */
export const readNow = cache(() => Date.now());

/** Two years of nightly figures: twelve months drawn, and the same months a year earlier for the compare line. */
export const metricsHistory = cache(() => fetchMetrics(731));

export const snapshotFreshness = cache(() => fetchSnapshotFreshness());

export const loginStats = cache(() => fetchLoginActivityStats());

/** Plan names by code (the snapshot's plan_breakdown is keyed by code), the newest version's name winning. */
export const planNames = cache(async (): Promise<Map<string, string>> => {
  const { data, error } = await db().from("plans").select("code, name, version").order("version", { ascending: true });
  if (error) throw new Error(`Could not load plan names: ${error.message}`);
  return new Map(((data ?? []) as { code: string; name: string }[]).map((row) => [row.code, row.name]));
});

const SIGN_IN_PAGE = 1000;
const SIGN_IN_CAP = 50_000;

/**
 * Successful sign-ins since `sinceIso`, one timestamp each, for the per-day graph. Staff sign-ins only for a
 * role that may see them (lib/loginEvents/present.ts staffLoginsVisibleTo): a total must not leak what the
 * list hides. Read newest first in pages of 1,000 (PostgREST's row cap); `capped` says the read stopped at its ceiling,
 * so the oldest buckets are short.
 */
export const signInEvents = cache(async (sinceIso: string, includeStaff: boolean): Promise<{ events: { at: string }[]; capped: boolean }> => {
  const events: { at: string }[] = [];
  for (let from = 0; from < SIGN_IN_CAP; from += SIGN_IN_PAGE) {
    let query = db().from("login_events").select("ts").eq("success", true).gte("ts", sinceIso);
    if (!includeStaff) query = query.eq("actor_type", "user");
    const { data, error } = await query.order("ts", { ascending: false }).order("id", { ascending: false }).range(from, from + SIGN_IN_PAGE - 1);
    if (error) throw new Error(`Could not load sign-ins: ${error.message}`);
    const rows = (data ?? []) as { ts: string }[];
    for (const row of rows) events.push({ at: row.ts });
    if (rows.length < SIGN_IN_PAGE) return { events, capped: false };
  }
  return { events, capped: true };
});

/** Paid invoices since `sinceIso`, by the day they were paid: what was actually collected, live. */
export const paidInvoices = cache(async (sinceIso: string): Promise<{ at: string; value: number }[]> => {
  const { data, error } = await db().from("platform_invoices").select("paid_at, total_cents").eq("status", "paid").gte("paid_at", sinceIso);
  if (error) throw new Error(`Could not load payments: ${error.message}`);
  return ((data ?? []) as { paid_at: string | null; total_cents: number }[]).filter((row) => row.paid_at).map((row) => ({ at: row.paid_at!, value: row.total_cents }));
});

/** This calendar month's invoices, as the Invoices page totals them: void is not invoiced, only paid is collected. */
export const monthInvoiceTotals = cache(async (): Promise<{ invoicedCents: number; collectedCents: number }> => {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { data, error } = await db().from("platform_invoices").select("status, total_cents").gte("created_at", monthStart);
  if (error) throw new Error(`Could not load this month's invoices: ${error.message}`);
  const rows = (data ?? []) as { status: string; total_cents: number }[];
  return {
    invoicedCents: rows.filter((row) => row.status !== "void").reduce((sum, row) => sum + row.total_cents, 0),
    collectedCents: rows.filter((row) => row.status === "paid").reduce((sum, row) => sum + row.total_cents, 0),
  };
});

/** Trials now: in flight, ending within two days, and the trials that ended in the last 30 days with their statuses. */
export const trialsNow = cache(async () => {
  const now = Date.now();
  const [inFlight, trials, ended] = await Promise.all([
    db().from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "trialing"),
    fetchTrials(),
    db().from("subscriptions").select("status").gte("trial_ends_at", new Date(now - 30 * DAY_MS).toISOString()).lte("trial_ends_at", new Date(now).toISOString()),
  ]);
  if (ended.error) throw new Error(`Could not load ended trials: ${ended.error.message}`);
  return {
    inFlight: counted(inFlight, "trials in flight"),
    endingWithinTwoDays: trials.filter((trial) => typeof trial.days_remaining === "number" && trial.days_remaining <= 2).length,
    endedLast30: (ended.data ?? []) as { status: string }[],
  };
});

export const suspendedTenants = cache(async () => counted(await db().from("tenants").select("id", { count: "exact", head: true }).eq("status", "suspended"), "suspended customers"));

/* ── Money ─────────────────────────────────────────────────────────────────────────────────── */

export type ChaseInvoice = { id: string; number: string; tenantName: string; totalCents: number; dueAt: string | null; reconciliation: string; providerTotalCents: number | null };
export type PastDueSubscription = { id: string; tenantId: string; tenantName: string; planName: string | null; periodEnd: string | null };

const CHASE_LIMIT = 50;
const INVOICE_COLUMNS = "id, number, total_cents, provider_total_cents, reconciliation, due_at, tenants(name)";
type RawInvoice = { id: string; number: string; total_cents: number; provider_total_cents: number | null; reconciliation: string; due_at: string | null; tenants: { name: string } | null };
const toChase = (row: RawInvoice): ChaseInvoice => ({ id: row.id, number: row.number, tenantName: row.tenants?.name ?? "—", totalCents: row.total_cents, dueAt: row.due_at, reconciliation: row.reconciliation, providerTotalCents: row.provider_total_cents });

/** What billing has to chase: overdue invoices (oldest due first), invoices that do not match the provider, past-due subscriptions. */
export const chaseLists = cache(async () => {
  const [overdue, overdueSum, mismatched, pastDue] = await Promise.all([
    db().from("platform_invoices").select(INVOICE_COLUMNS, { count: "exact" }).eq("status", "overdue").order("due_at", { ascending: true }).limit(CHASE_LIMIT),
    db().from("platform_invoices").select("total_cents").eq("status", "overdue"),
    db().from("platform_invoices").select(INVOICE_COLUMNS, { count: "exact" }).eq("reconciliation", "mismatched").order("created_at", { ascending: false }).limit(CHASE_LIMIT),
    db().from("subscriptions").select("id, tenant_id, current_period_end, tenants(name), plan:plans!subscriptions_plan_id_fkey(name)", { count: "exact" }).eq("status", "past_due").order("current_period_end", { ascending: true }).limit(CHASE_LIMIT),
  ]);
  for (const [label, result] of [["overdue invoices", overdue], ["overdue total", overdueSum], ["mismatched invoices", mismatched], ["past-due subscriptions", pastDue]] as const) {
    if (result.error) throw new Error(`Could not load ${label}: ${result.error.message}`);
  }
  return {
    overdue: ((overdue.data ?? []) as unknown as RawInvoice[]).map(toChase),
    overdueCount: overdue.count ?? 0,
    overdueCents: ((overdueSum.data ?? []) as { total_cents: number }[]).reduce((sum, row) => sum + row.total_cents, 0),
    mismatched: ((mismatched.data ?? []) as unknown as RawInvoice[]).map(toChase),
    mismatchedCount: mismatched.count ?? 0,
    pastDue: ((pastDue.data ?? []) as unknown as { id: string; tenant_id: string; current_period_end: string | null; tenants: { name: string } | null; plan: { name: string } | null }[]).map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      tenantName: row.tenants?.name ?? "—",
      planName: row.plan?.name ?? null,
      periodEnd: row.current_period_end,
    })) as PastDueSubscription[],
    pastDueCount: pastDue.count ?? 0,
  };
});

/** Subscriptions cancelled in the last 30 days, per plan code: live, so it never borrows the snapshot's age. */
export const cancellationsByPlan = cache(async (): Promise<Map<string, number>> => {
  const { data, error } = await db()
    .from("subscriptions")
    .select("plan:plans!subscriptions_plan_id_fkey(code)")
    .gte("cancelled_at", new Date(Date.now() - 30 * DAY_MS).toISOString());
  if (error) throw new Error(`Could not load cancellations: ${error.message}`);
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as unknown as { plan: { code: string } | null }[]) {
    const code = row.plan?.code;
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return counts;
});

/* ── Customers ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The sign-up funnel as the board draws it: the Revenue page's funnel (lib/metrics/queries.ts fetchFunnel),
 * without its unmeasured profile step, and with "Became paid" read the same way its other steps are (distinct
 * tenants who signed up in the window and now hold a paying subscription).
 */
export const signupFunnel = cache(async (days: number): Promise<FunnelStep[]> => {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const [steps, paid] = await Promise.all([
    fetchFunnel(days),
    db().from("subscriptions").select("tenant_id, tenants!inner(created_at)").gte("tenants.created_at", since).in("status", ["active", "past_due", "cancelling"]),
  ]);
  if (paid.error) throw new Error(`Could not load the funnel (became paid): ${paid.error.message}`);
  const becamePaid: FunnelStep = { label: "Became paid", count: new Set(((paid.data ?? []) as { tenant_id: string }[]).map((row) => row.tenant_id)).size, measured: true };
  const kept = steps.filter((step) => step.label !== "Completed profile");
  const dayThirty = kept.findIndex((step) => step.label === "Active at day 30");
  if (dayThirty === -1) return [...kept, becamePaid];
  return [...kept.slice(0, dayThirty), becamePaid, ...kept.slice(dayThirty)];
});

/** Customers whose held seats reach their plan's limit: the staff alerts' own (minute-cached) read. */
export const seatLimited = cache(async () => {
  const state = await readPlatformState();
  if (!state.seatLimited) throw new Error("Could not check seat limits");
  return state.seatLimited;
});

/** The last seven days: sign-ups, cancellations, invitations unanswered after a week, and customers suspended now. */
export const lastSevenDays = cache(async () => {
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const [signups, cancellations, users, suspended] = await Promise.all([
    db().from("tenants").select("id", { count: "exact", head: true }).gte("created_at", since),
    db().from("subscriptions").select("id", { count: "exact", head: true }).gte("cancelled_at", since),
    fetchUsersListStats(),
    suspendedTenants(),
  ]);
  return {
    signups: counted(signups, "new sign-ups"),
    cancellations: counted(cancellations, "cancellations"),
    staleInvitations: users.invitedStale,
    suspended,
  };
});

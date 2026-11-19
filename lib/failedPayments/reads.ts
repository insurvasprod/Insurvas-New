import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  HISTORY_DAYS,
  episodesFrom,
  failureReason,
  ladderFor,
  nextAttempt,
  recoveryFigures,
  type Episode,
  type Ladder,
  type PaymentEvent,
  type RecoveryFigures,
} from "./model";

/**
 * Everything Admin › Billing › Failed payments shows (billing-r2 screen 4), read on each request: every customer
 * past due (their subscription, their unpaid invoice, the provider's reason and retry ladder), and 90 days of
 * failures that were recovered or lost. Read-only. The list throws when it cannot be read (the page says so);
 * the history settles on its own and leaves its figures blank when it cannot.
 */

// webhook_events is not in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;
const DAY_MS = 86_400_000;

export type PastDueRow = {
  subscriptionId: string;
  tenantId: string;
  tenantName: string;
  planName: string | null;
  /** What the failed renewal charges, at list price; null when unpriced. */
  amountCents: number | null;
  invoice: { id: string; number: string; totalCents: number; dueAt: string | null } | null;
  ladder: Ladder;
  ownerEmail: string | null;
  /** Whether the provider holds a membership we can send the customer's card page for. */
  hasMembership: boolean;
};

export type ClosedRow = Episode & { tenantName: string; planName: string | null; amountCents: number | null };

export type FailedPaymentsBoard = {
  pastDue: PastDueRow[];
  /** null when the 90-day history could not be read. */
  figures: RecoveryFigures | null;
  recovered: ClosedRow[] | null;
  lost: ClosedRow[] | null;
};

type Sub = { id: string; tenant_id: string; status: string; plan_id: string; billing_cycle: string; whop_membership_id: string | null; cancelled_at: string | null; last_provider_event_at: string | null; tenants: { name: string } | null; plan: { name: string } | null };
type EventRow = { tenant_id: string | null; event_type: string; occurred_at: string | null; received_at: string; payload: unknown };

const EVENT_TYPES = ["payment.failed", "payment.succeeded", "invoice.past_due"];

export async function fetchFailedPaymentsBoard(now = Date.now()): Promise<FailedPaymentsBoard> {
  const pastDueRead = await db()
    .from("subscriptions")
    .select("id, tenant_id, status, plan_id, billing_cycle, whop_membership_id, cancelled_at, last_provider_event_at, tenants(name), plan:plans!subscriptions_plan_id_fkey(name)")
    .eq("status", "past_due")
    .order("current_period_end", { ascending: true });
  if (pastDueRead.error) throw new Error(`Could not read past-due subscriptions: ${pastDueRead.error.message}`);
  const subs = (pastDueRead.data ?? []) as Sub[];
  const tenantIds = [...new Set(subs.map((s) => s.tenant_id))];
  const since = new Date(now - HISTORY_DAYS * DAY_MS).toISOString();

  const [events, invoices, owners, history] = await Promise.all([
    tenantIds.length
      ? db().from("webhook_events").select("tenant_id, event_type, occurred_at, received_at, payload").in("tenant_id", tenantIds).in("event_type", EVENT_TYPES).order("received_at", { ascending: false }).limit(500)
      : { data: [], error: null },
    tenantIds.length
      ? db().from("platform_invoices").select("id, tenant_id, number, total_cents, due_at, status").in("tenant_id", tenantIds).in("status", ["overdue", "issued"]).order("due_at", { ascending: true })
      : { data: [], error: null },
    tenantIds.length
      ? db().from("tenant_users").select("tenant_id, role, users!tenant_users_user_id_fkey(email)").in("tenant_id", tenantIds).eq("role", "owner")
      : { data: [], error: null },
    readHistory(since),
  ]);
  if (events.error) throw new Error(`Could not read payment events: ${events.error.message}`);
  if (invoices.error) throw new Error(`Could not read invoices: ${invoices.error.message}`);

  const toEvent = (row: EventRow): PaymentEvent => ({ tenantId: row.tenant_id as string, type: row.event_type, at: row.occurred_at ?? row.received_at, nextAttemptAt: nextAttempt(row.payload), reason: failureReason(row.payload) });
  const eventsBy = new Map<string, PaymentEvent[]>();
  for (const row of (events.data ?? []) as EventRow[]) {
    if (!row.tenant_id) continue;
    const list = eventsBy.get(row.tenant_id) ?? [];
    list.push(toEvent(row));
    eventsBy.set(row.tenant_id, list);
  }
  const invoiceBy = new Map<string, { id: string; number: string; totalCents: number; dueAt: string | null }>();
  for (const row of (invoices.data ?? []) as { id: string; tenant_id: string; number: string; total_cents: number; due_at: string | null; status: string }[]) {
    // The oldest unpaid one; overdue wins over merely issued.
    const held = invoiceBy.get(row.tenant_id);
    if (!held || row.status === "overdue") invoiceBy.set(row.tenant_id, { id: row.id, number: row.number, totalCents: row.total_cents, dueAt: row.due_at });
  }
  const ownerBy = new Map<string, string>();
  for (const row of ((owners.data ?? []) as { tenant_id: string; users: { email?: string } | { email?: string }[] | null }[])) {
    const user = Array.isArray(row.users) ? row.users[0] : row.users;
    if (user?.email && !ownerBy.has(row.tenant_id)) ownerBy.set(row.tenant_id, user.email);
  }

  const prices = await priceMap([...subs, ...(history?.subs ?? [])]);
  const amountOf = (s: Sub) => prices.get(`${s.plan_id}:${s.billing_cycle}`) ?? null;

  const pastDue: PastDueRow[] = subs.map((s) => ({
    subscriptionId: s.id,
    tenantId: s.tenant_id,
    tenantName: s.tenants?.name ?? s.tenant_id,
    planName: s.plan?.name ?? null,
    amountCents: amountOf(s),
    invoice: invoiceBy.get(s.tenant_id) ?? null,
    ladder: ladderFor(eventsBy.get(s.tenant_id) ?? [], now),
    ownerEmail: ownerBy.get(s.tenant_id) ?? null,
    hasMembership: Boolean(s.whop_membership_id),
  }));

  if (!history) return { pastDue, figures: null, recovered: null, lost: null };
  const subOf = new Map(history.subs.map((s) => [s.tenant_id, s]));
  const closed = (outcome: Episode["outcome"]) =>
    history.episodes.filter((e) => e.outcome === outcome).map((e): ClosedRow => {
      const s = subOf.get(e.tenantId);
      return { ...e, tenantName: s?.tenants?.name ?? history.names.get(e.tenantId) ?? e.tenantId, planName: s?.plan?.name ?? null, amountCents: s ? amountOf(s) : null };
    });
  return { pastDue, figures: recoveryFigures(history.episodes, now), recovered: closed("recovered"), lost: closed("lost") };
}

/** Ninety days of failures and successes, every customer, as episodes. Null when it cannot be read. */
async function readHistory(since: string): Promise<{ episodes: Episode[]; subs: Sub[]; names: Map<string, string> } | null> {
  try {
    const read = await db().from("webhook_events").select("tenant_id, event_type, occurred_at, received_at, payload").in("event_type", ["payment.failed", "payment.succeeded"]).gte("received_at", since).order("received_at", { ascending: true }).limit(5000);
    if (read.error) throw new Error(read.error.message);
    const rows = ((read.data ?? []) as EventRow[]).filter((row) => row.tenant_id);
    const tenantIds = [...new Set(rows.map((row) => row.tenant_id as string))];
    if (!tenantIds.length) return { episodes: [], subs: [], names: new Map() };
    const [subsRead, tenantsRead] = await Promise.all([
      db().from("subscriptions").select("id, tenant_id, status, plan_id, billing_cycle, whop_membership_id, cancelled_at, last_provider_event_at, started_at, tenants(name), plan:plans!subscriptions_plan_id_fkey(name)").in("tenant_id", tenantIds).order("started_at", { ascending: false }),
      db().from("tenants").select("id, name").in("id", tenantIds),
    ]);
    if (subsRead.error) throw new Error(subsRead.error.message);
    // Each customer's newest subscription says how the run of failures ended.
    const latest = new Map<string, Sub>();
    for (const s of (subsRead.data ?? []) as Sub[]) if (!latest.has(s.tenant_id)) latest.set(s.tenant_id, s);
    const lostAt = new Map<string, string>();
    for (const s of latest.values()) {
      if (s.status === "suspended" || s.status === "cancelled") {
        const at = s.cancelled_at ?? s.last_provider_event_at;
        if (at) lostAt.set(s.tenant_id, at);
      }
    }
    const events = rows.map((row): PaymentEvent => ({ tenantId: row.tenant_id as string, type: row.event_type, at: row.occurred_at ?? row.received_at, nextAttemptAt: null, reason: failureReason(row.payload) }));
    const names = new Map(((tenantsRead.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
    return { episodes: episodesFrom(events, lostAt), subs: [...latest.values()], names };
  } catch (error) {
    console.error("[admin/failed-payments] history read failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Each plan's price on each cycle, keyed "plan:cycle". */
async function priceMap(subs: readonly Sub[]): Promise<Map<string, number | null>> {
  const planIds = [...new Set(subs.map((s) => s.plan_id))];
  const out = new Map<string, number | null>();
  if (!planIds.length) return out;
  const { data, error } = await db().from("plan_prices").select("plan_id, price_monthly_cents, price_quarterly_cents, price_yearly_cents").in("plan_id", planIds);
  if (error) return out;
  for (const row of (data ?? []) as Record<string, string | number | null>[]) {
    for (const cycle of ["monthly", "quarterly", "yearly"]) out.set(`${row.plan_id}:${cycle}`, (row[`price_${cycle}_cents`] as number | null) ?? null);
  }
  return out;
}

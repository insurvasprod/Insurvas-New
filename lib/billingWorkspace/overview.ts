import "server-only";

import { AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { fetchMetrics } from "@/lib/metrics/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { fetchSubscriptionsBoard } from "@/lib/subscriptionsList/board";
import { bucketCounts, bucketSums, monthBuckets, weekBuckets, overdueAt, type Bucket } from "./series";

/**
 * The billing workspace's figures, Coming up and Just happened (billing-r2 screen 1). Each section reads on its
 * own and throws on a database error, so its card says it could not load instead of drawing a confident zero;
 * the page wraps each in its own Suspense and error boundary. Read-only.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;
const DAY_MS = 86_400_000;

function must<T>(result: { data: T[] | null; error: { message: string } | null }, label: string): T[] {
  if (result.error) throw new Error(`Could not load ${label}: ${result.error.message}`);
  return result.data ?? [];
}

/* ── Figures ───────────────────────────────────────────────────────────────────────────────────── */

export type WorkspaceFigures = {
  mrr: { cents: number | null; active: number; plans: number; trend: number[] };
  collected: { cents: number; invoicedCents: number; trend: number[] };
  overdue: { count: number; owedCents: number; trend: number[] };
  trialsEnding: { count: number; noCard: number; trend: number[] };
  refunds: { waiting: number; trend: number[] };
};

type InvoiceRow = { status: string; total_cents: number; created_at: string; due_at: string | null; paid_at: string | null; voided_at: string | null };

export async function workspaceFigures(now = Date.now()): Promise<WorkspaceFigures> {
  const nowDate = new Date(now);
  const months = monthBuckets(now, 6);
  const weeks = weekBuckets(now, 8);
  const since = months[0].start;
  const [board, metrics, invoices, notes, trials] = await Promise.all([
    fetchSubscriptionsBoard(nowDate),
    fetchMetrics(91).catch(() => []),
    db().from("platform_invoices").select("status, total_cents, created_at, due_at, paid_at, voided_at").or(`created_at.gte.${since},status.eq.overdue`),
    db().from("credit_notes").select("status, created_at").or(`created_at.gte.${weeks[0].start},status.eq.pending_approval`),
    db().from("admin_trials_in_flight").select("trial_ends_at, has_payment_method"),
  ]);
  if (board.listError) throw new Error("Could not load subscriptions");
  const invoiceRows = must<InvoiceRow>(invoices, "invoices");
  const noteRows = must<{ status: string; created_at: string }>(notes, "credit notes");
  const trialRows = must<{ trial_ends_at: string | null; has_payment_method: boolean | null }>(trials, "trials");

  const monthStart = months[months.length - 1].start;
  const thisMonth = invoiceRows.filter((row) => row.created_at >= monthStart);
  const overdue = invoiceRows.filter((row) => row.status === "overdue");

  // MRR over 13 weeks from the nightly snapshot, one point a week; the figure itself is live.
  const mrrTrend = (metrics as { date: string; mrr_cents: number }[]).filter((_, index, all) => (all.length - 1 - index) % 7 === 0).map((day) => day.mrr_cents);

  const weekEnd = now + 7 * DAY_MS;
  const ending = trialRows.filter((row) => row.trial_ends_at && Date.parse(row.trial_ends_at) <= weekEnd);
  const days: Bucket[] = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() + i));
    return { key: String(i), start: start.toISOString(), end: new Date(start.getTime() + DAY_MS).toISOString() };
  });

  return {
    mrr: { cents: board.figures.mrrCents, active: board.figures.active, plans: board.figures.activePlans, trend: mrrTrend },
    collected: {
      cents: thisMonth.filter((row) => row.status === "paid").reduce((sum, row) => sum + row.total_cents, 0),
      invoicedCents: thisMonth.filter((row) => row.status !== "void").reduce((sum, row) => sum + row.total_cents, 0),
      trend: bucketSums(invoiceRows.filter((row) => row.status === "paid" && row.paid_at).map((row) => ({ at: row.paid_at as string, value: row.total_cents })), months),
    },
    overdue: {
      count: overdue.length,
      owedCents: overdue.reduce((sum, row) => sum + row.total_cents, 0),
      trend: weeks.map((week) => overdueAt(invoiceRows, week.end)),
    },
    trialsEnding: {
      count: ending.length,
      noCard: ending.filter((row) => !row.has_payment_method).length,
      trend: bucketCounts(ending.map((row) => row.trial_ends_at as string), days),
    },
    refunds: {
      waiting: noteRows.filter((row) => row.status === "pending_approval").length,
      trend: bucketCounts(noteRows.map((row) => row.created_at), weeks),
    },
  };
}

/* ── Coming up · 7 days ────────────────────────────────────────────────────────────────────────── */

export type ComingUp = {
  renewals: { count: number; cents: number | null };
  trialsEnding: number;
  queued: number;
  couponsExpiring: number;
  offersStarting: { name: string; startsAt: string }[];
};

export async function comingUp(now = Date.now()): Promise<ComingUp> {
  const end = new Date(now + 7 * DAY_MS).toISOString();
  const start = new Date(now).toISOString();
  const [board, coupons, offers] = await Promise.all([
    fetchSubscriptionsBoard(new Date(now)),
    db().from("coupons").select("id", { count: "exact", head: true }).eq("is_active", true).gte("expires_at", start).lte("expires_at", end),
    db().from("offers").select("name, starts_at").eq("is_active", true).gte("starts_at", start).lte("starts_at", end).order("starts_at"),
  ]);
  if (board.listError) throw new Error("Could not load subscriptions");
  if (coupons.error) throw new Error(`Could not load coupons: ${coupons.error.message}`);
  const offerRows = must<{ name: string; starts_at: string }>(offers, "offers");

  const renewing = board.rows.filter((row) => row.renewsWithinWeek);
  const priced = renewing.every((row) => row.cycleCents !== null);
  return {
    renewals: { count: renewing.length, cents: priced ? renewing.reduce((sum, row) => sum + (row.cycleCents ?? 0), 0) : null },
    trialsEnding: board.rows.filter((row) => row.status === "trialing" && row.trialEndsAt && Date.parse(row.trialEndsAt) <= now + 7 * DAY_MS).length,
    queued: board.figures.queuedPlanChanges,
    couponsExpiring: coupons.count ?? 0,
    offersStarting: offerRows.map((row) => ({ name: row.name, startsAt: row.starts_at })),
  };
}

/* ── Just happened ─────────────────────────────────────────────────────────────────────────────── */

export type HappenedItem = { id: string; at: string; text: string; tone: "good" | "warn" | "bad" | "info"; href: string | null };

const BILLING_PREFIXES = ["subscription.", "trial.", "invoice.", "payment.", "coupon.", "offer.", "credit_note."];
const BAD = /failed|declined|voided|cancelled|deactivat/;
const GOOD = /paid|recorded|converted|approved|reconciled|succeeded/;

function labelFor(action: string): string {
  return (AUDIT_ACTION_LABELS as Record<string, string>)[action as AuditAction] ?? action;
}

function decline(payload: unknown): string | null {
  const data = payload && typeof payload === "object" ? (payload as { data?: Record<string, unknown> }).data : null;
  const message = data?.failure_message ?? data?.failure_reason;
  return typeof message === "string" && message.trim() ? message.trim().slice(0, 80) : null;
}

/**
 * The latest billing changes: the audit log's billing actions and the provider's payment events, newest first.
 * The audit log keeps its own rule (lib/audit/logQuery.ts): only a super admin reads other staff members'
 * actions; anyone else sees their own, plus what customers, the provider and the system did.
 */
export async function justHappened(viewer: { id: string; role: AdminRole }, limit = 12): Promise<HappenedItem[]> {
  let audit = db()
    .from("audit_log")
    .select("id, ts, actor_type, actor_id, action, target_type, target_id, metadata")
    .or(BILLING_PREFIXES.map((prefix) => `action.like.${prefix}*`).join(","))
    .order("ts", { ascending: false })
    .limit(limit);
  if (viewer.role !== "super_admin") audit = audit.or(`actor_type.neq.admin,actor_id.eq.${viewer.id}`);
  const [auditRead, events] = await Promise.all([
    audit,
    db().from("webhook_events").select("id, event_type, occurred_at, received_at, tenant_id, payload").in("event_type", ["payment.succeeded", "payment.failed"]).order("received_at", { ascending: false }).limit(limit),
  ]);
  type AuditRow = { id: string; ts: string; actor_type: string; actor_id: string | null; action: string; target_type: string | null; target_id: string | null; metadata: Record<string, unknown> | null };
  type EventRow = { id: string; event_type: string; occurred_at: string | null; received_at: string; tenant_id: string | null; payload: unknown };
  const rows = must<AuditRow>(auditRead, "the audit log");
  const eventRows = must<EventRow>(events, "payment events");

  const subIds = rows.filter((row) => row.target_type === "subscription" && row.target_id).map((row) => row.target_id as string);
  const invoiceIds = rows.filter((row) => row.target_type === "invoice" && row.target_id).map((row) => row.target_id as string);
  const actorIds = rows.filter((row) => row.actor_type === "admin" && row.actor_id).map((row) => row.actor_id as string);
  const [subs, invoices, admins] = await Promise.all([
    subIds.length ? db().from("subscriptions").select("id, tenant_id").in("id", [...new Set(subIds)]) : { data: [], error: null },
    invoiceIds.length ? db().from("platform_invoices").select("id, number, tenant_id").in("id", [...new Set(invoiceIds)]) : { data: [], error: null },
    actorIds.length ? db().from("admin_users").select("id, name").in("id", [...new Set(actorIds)]) : { data: [], error: null },
  ]);
  const subTenant = new Map(((subs.data ?? []) as { id: string; tenant_id: string }[]).map((row) => [row.id, row.tenant_id]));
  const invoiceBy = new Map(((invoices.data ?? []) as { id: string; number: string; tenant_id: string }[]).map((row) => [row.id, row]));
  const adminName = new Map(((admins.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));

  const tenantOf = (row: AuditRow): string | null => {
    const meta = row.metadata?.tenantId ?? row.metadata?.tenant_id;
    if (typeof meta === "string") return meta;
    if (row.target_type === "tenant") return row.target_id;
    if (row.target_type === "subscription" && row.target_id) return subTenant.get(row.target_id) ?? null;
    if (row.target_type === "invoice" && row.target_id) return invoiceBy.get(row.target_id)?.tenant_id ?? null;
    return null;
  };
  const tenantIds = [...new Set([...rows.map(tenantOf), ...eventRows.map((row) => row.tenant_id)].filter((id): id is string => Boolean(id)))];
  const tenants = tenantIds.length ? await db().from("tenants").select("id, name").in("id", tenantIds) : { data: [] };
  const tenantName = new Map(((tenants.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));

  const items: HappenedItem[] = [
    ...rows.map((row): HappenedItem => {
      const tenantId = tenantOf(row);
      const who = tenantId ? tenantName.get(tenantId) ?? null : null;
      const invoice = row.target_type === "invoice" && row.target_id ? invoiceBy.get(row.target_id) : null;
      const by = row.actor_type === "admin" && row.actor_id ? adminName.get(row.actor_id) : null;
      const text = [labelFor(row.action), who ? `· ${who}` : null, invoice ? `· ${invoice.number}` : null, by ? `· by ${by}` : null].filter(Boolean).join(" ");
      return {
        id: `a-${row.id}`,
        at: row.ts,
        text,
        tone: BAD.test(row.action) ? "bad" : GOOD.test(row.action) ? "good" : row.action.startsWith("credit_note") ? "info" : "warn",
        href: invoice ? `/admin/invoices/${invoice.id}` : tenantId ? `/admin/tenants/${tenantId}?tab=subscription` : null,
      };
    }),
    ...eventRows.map((row): HappenedItem => {
      const who = row.tenant_id ? tenantName.get(row.tenant_id) ?? null : null;
      const failed = row.event_type === "payment.failed";
      const why = failed ? decline(row.payload) : null;
      return {
        id: `w-${row.id}`,
        at: row.occurred_at ?? row.received_at,
        text: failed ? `${who ? `${who}: payment` : "A payment"} failed${why ? ` (${why})` : ""}` : who ? `${who} paid` : "Payment received (customer not matched)",
        tone: failed ? "bad" : "good",
        href: row.tenant_id ? (failed ? "/admin/billing/failed-payments" : `/admin/tenants/${row.tenant_id}?tab=subscription`) : null,
      };
    }),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

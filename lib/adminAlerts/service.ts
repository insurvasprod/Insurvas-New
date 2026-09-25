import "server-only";

import { getPeriodBillingHeartbeat } from "@/lib/billing/monitor";
import { describeBillingHeartbeat } from "@/lib/billing/heartbeat";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getMaintenanceStatus } from "@/lib/system/service";
import { fetchTrials } from "@/lib/trials/queries";
import { heldSeat } from "@/lib/tenantTeam/seats";
import {
  STAFF_NOTIFICATION_ACTIONS, STAFF_NOTIFICATION_WINDOW_DAYS,
  buildStaffAlerts, buildStaffNotifications,
  type StaffAlertInput, type StaffEventInput, type StaffRole,
} from "./presentation";

// Several of these tables (webhook_events, admin_trials_in_flight, the new read table) are not in
// the generated types; access stays untyped here and nowhere else.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

type DbError = { code?: string; message?: string } | null | undefined;
function isMissingRelation(error: DbError) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

/** A compliance source is failing when it has failures today and no success in the last hour. */
const SOURCE_SILENT_MS = 60 * 60_000;

/**
 * Platform state changes slowly and every open staff tab polls, so the raw reads are shared for a
 * minute across tabs and admins. Only the role filter and the read marks are per person, and those
 * are applied after the cache.
 */
const STATE_CACHE_MS = 60_000;
let stateCache: { at: number; value: Omit<StaffAlertInput, "role" | "now"> & { trials: StaffEventInput["trials"]; audit: StaffEventInput["audit"] } } | null = null;

// Each read settles on its own: one failing source must not blank the whole bell.
async function settle<T>(promise: Promise<T>, label: string): Promise<T | null> {
  try { return await promise; } catch (error) { console.error(`[admin-alerts] ${label}:`, error instanceof Error ? error.message : error); return null; }
}

async function stuckWebhooks() {
  const [oldest, count, latestError] = await Promise.all([
    db().from("webhook_events").select("received_at").is("processed_at", null).order("received_at", { ascending: true }).limit(1).maybeSingle(),
    db().from("webhook_events").select("event_id", { count: "exact", head: true }).is("processed_at", null),
    db().from("webhook_events").select("process_error").is("processed_at", null).not("process_error", "is", null).order("received_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (oldest.error || count.error) throw new Error(oldest.error?.message ?? count.error?.message);
  return { count: count.count ?? 0, oldestReceivedAt: (oldest.data as { received_at?: string } | null)?.received_at ?? null, lastError: (latestError.data as { process_error?: string } | null)?.process_error ?? null };
}

async function failingSources(now: number) {
  const result = await db().from("compliance_vendors").select("name, last_success_at, failure_count_24h").eq("is_enabled", true).gt("failure_count_24h", 0);
  if (result.error) throw new Error(result.error.message);
  return ((result.data ?? []) as { name: string; last_success_at: string | null; failure_count_24h: number }[])
    .filter((row) => !row.last_success_at || now - new Date(row.last_success_at).getTime() > SOURCE_SILENT_MS)
    .map((row) => ({ name: row.name, failures24h: row.failure_count_24h, lastSuccessAt: row.last_success_at }));
}

async function billingRun() {
  // The same window the scheduled check uses, so the bar and the operator email agree.
  const maxAgeSeconds = Math.max(3_600, Math.min(Number(process.env.PERIOD_BILLING_HEARTBEAT_SECONDS ?? 129_600), 604_800));
  const heartbeat = await getPeriodBillingHeartbeat(maxAgeSeconds);
  return { healthy: heartbeat.healthy, description: describeBillingHeartbeat(heartbeat) };
}

async function pastDueCount() {
  const result = await db().from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "past_due");
  if (result.error) throw new Error(result.error.message);
  return result.count ?? 0;
}

/** Customers whose held seats (the one seat rule, lib/tenantTeam/seats.ts, as tenant_seats_used counts them) reach the plan's max_seats. */
async function seatLimited() {
  const subscriptions = await db().from("subscriptions").select("tenant_id, plan_id").in("status", ["trialing", "active", "past_due"]);
  if (subscriptions.error) throw new Error(subscriptions.error.message);
  const subs = (subscriptions.data ?? []) as { tenant_id: string; plan_id: string }[];
  if (!subs.length) return [];
  const planIds = [...new Set(subs.map((row) => row.plan_id))];
  const limits = await db().from("plan_limits").select("plan_id, max_seats").in("plan_id", planIds);
  if (limits.error) throw new Error(limits.error.message);
  const maxByPlan = new Map(((limits.data ?? []) as { plan_id: string; max_seats: number | null }[]).filter((row) => typeof row.max_seats === "number" && row.max_seats > 0).map((row) => [row.plan_id, row.max_seats as number]));
  const limited = subs.filter((row) => maxByPlan.has(row.plan_id));
  if (!limited.length) return [];
  const tenantIds = [...new Set(limited.map((row) => row.tenant_id))];
  const [members, tenants, invites] = await Promise.all([
    db().from("tenant_users").select("tenant_id, accepted_at, users!tenant_users_user_id_fkey(status)").in("tenant_id", tenantIds),
    db().from("tenants").select("id, name").in("id", tenantIds),
    db().from("user_invitations").select("tenant_id").in("tenant_id", tenantIds).is("partner_id", null).eq("purpose", "invite").is("accepted_at", null).gt("expires_at", new Date().toISOString()),
  ]);
  if (members.error) throw new Error(members.error.message);
  const used = new Map<string, number>();
  for (const row of (members.data ?? []) as unknown as { tenant_id: string; accepted_at: string | null; users: { status: string } | null }[]) {
    if (heldSeat({ status: row.users?.status, acceptedAt: row.accepted_at })) used.set(row.tenant_id, (used.get(row.tenant_id) ?? 0) + 1);
  }
  const pending = new Map<string, number>();
  for (const row of (invites.data ?? []) as { tenant_id: string }[]) pending.set(row.tenant_id, (pending.get(row.tenant_id) ?? 0) + 1);
  const names = new Map(((tenants.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  return limited
    .map((row) => ({ tenantId: row.tenant_id, tenantName: names.get(row.tenant_id) ?? "A customer", used: used.get(row.tenant_id) ?? 0, max: maxByPlan.get(row.plan_id)!, pendingInvites: pending.get(row.tenant_id) ?? 0 }))
    .filter((row) => row.used >= row.max)
    .sort((a, b) => a.tenantName.localeCompare(b.tenantName));
}

async function auditEvents(now: number): Promise<StaffEventInput["audit"]> {
  const since = new Date(now - STAFF_NOTIFICATION_WINDOW_DAYS * 86_400_000).toISOString();
  const result = await db().from("audit_log").select("id, action, ts, reason, metadata").in("action", [...STAFF_NOTIFICATION_ACTIONS]).gte("ts", since).order("ts", { ascending: false }).limit(100);
  if (result.error) throw new Error(result.error.message);
  const rows = (result.data ?? []) as { id: string | number; action: string; ts: string; reason: string | null; metadata: Record<string, unknown> | null }[];
  const tenantIdOf = (row: (typeof rows)[number]) => (typeof row.metadata?.tenantId === "string" ? row.metadata.tenantId : null);
  const plan = (row: (typeof rows)[number]) => (row.metadata?.plan && typeof row.metadata.plan === "object" ? row.metadata.plan as { from?: unknown; to?: unknown } : null);
  const tenantIds = [...new Set(rows.map(tenantIdOf).filter((id): id is string => Boolean(id)))];
  const planIds = [...new Set(rows.flatMap((row) => [plan(row)?.from, plan(row)?.to]).filter((id): id is string => typeof id === "string"))];
  const [tenants, plans] = await Promise.all([
    tenantIds.length ? db().from("tenants").select("id, name").in("id", tenantIds) : { data: [] },
    planIds.length ? db().from("plans").select("id, name").in("id", planIds) : { data: [] },
  ]);
  const tenantNames = new Map(((tenants.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  const planNames = new Map(((plans.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  return rows.map((row) => {
    const tenantId = tenantIdOf(row);
    const change = plan(row);
    return {
      id: String(row.id),
      action: row.action,
      ts: row.ts,
      tenantId,
      tenantName: tenantId ? tenantNames.get(tenantId) ?? null : null,
      fromPlan: typeof change?.from === "string" ? planNames.get(change.from) ?? null : null,
      toPlan: typeof change?.to === "string" ? planNames.get(change.to) ?? null : null,
      appliedNow: typeof row.metadata?.appliedNow === "boolean" ? row.metadata.appliedNow : null,
      reason: row.reason,
    };
  });
}

async function platformState(now: number) {
  if (stateCache && now - stateCache.at < STATE_CACHE_MS) return stateCache.value;
  const [webhooks, sources, maintenance, run, pastDue, seats, trials, audit] = await Promise.all([
    settle(stuckWebhooks(), "webhooks"),
    settle(failingSources(now), "compliance sources"),
    settle(getMaintenanceStatus(), "maintenance"),
    settle(billingRun(), "billing run"),
    settle(pastDueCount(), "past due"),
    settle(seatLimited(), "seat limits"),
    settle(fetchTrials(), "trials"),
    settle(auditEvents(now), "audit events"),
  ]);
  const value = {
    stuckWebhooks: webhooks,
    failingSources: sources,
    maintenance: maintenance ? { level: maintenance.level, message: maintenance.message } : null,
    billingRun: run,
    pastDueCount: pastDue,
    seatLimited: seats,
    trials: (trials ?? []).map((row) => ({ subscriptionId: row.subscription_id, tenantId: row.tenant_id, tenantName: row.tenant_name, trialEndsAt: row.trial_ends_at, startedAt: row.started_at, daysRemaining: row.days_remaining, hasPaymentMethod: row.has_payment_method })),
    audit: audit ?? [],
  };
  stateCache = { at: now, value };
  return value;
}

/** Whether read marks can be stored: false until 20260924200100 is applied. */
let readTable: "unknown" | "present" | "absent" = "unknown";

async function readKeys(adminId: string): Promise<Set<string>> {
  if (readTable === "absent") return new Set();
  const since = new Date(Date.now() - (STAFF_NOTIFICATION_WINDOW_DAYS + 30) * 86_400_000).toISOString();
  const result = await db().from("admin_notification_reads").select("source_key").eq("admin_user_id", adminId).gte("read_at", since).limit(2000);
  if (result.error) {
    if (isMissingRelation(result.error)) { readTable = "absent"; console.warn("[admin-alerts] admin_notification_reads is missing; staff read marks will not persist until 20260924200100 is applied."); }
    else console.error(`[admin-alerts] could not read read marks: ${result.error.message}`);
    return new Set();
  }
  readTable = "present";
  return new Set(((result.data ?? []) as { source_key: string }[]).map((row) => row.source_key));
}

export async function listStaffFeed(adminId: string, role: StaffRole) {
  const now = Date.now();
  const [state, read] = await Promise.all([platformState(now), readKeys(adminId)]);
  return {
    alerts: buildStaffAlerts({ ...state, role, now }),
    notifications: buildStaffNotifications({ role, now, trials: state.trials, audit: state.audit, readKeys: read }),
    readStateReady: readTable !== "absent",
  };
}

export class StaffReadStateUnavailable extends Error {}

export async function markStaffNotificationsRead(adminId: string, keys: string[]) {
  if (!keys.length) return { read: 0 };
  const result = await db().from("admin_notification_reads").upsert(keys.map((key) => ({ admin_user_id: adminId, source_key: key, read_at: new Date().toISOString() })), { onConflict: "admin_user_id,source_key", ignoreDuplicates: true });
  if (result.error) {
    if (isMissingRelation(result.error)) { readTable = "absent"; throw new StaffReadStateUnavailable("Read marks need the database update for staff notifications."); }
    throw new Error(result.error.message);
  }
  readTable = "present";
  return { read: keys.length };
}

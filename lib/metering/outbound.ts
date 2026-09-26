import "server-only";

import { getEntitlement } from "@/lib/entitlements/get";
import { checkMeterCapacity, recordUsage } from "@/lib/metering/enforce";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { heldSeat } from "@/lib/tenantTeam/seats";

export type OutboundLimitKey =
  | "max_setter_seats"
  | "max_active_campaigns"
  | "monthly_leads_imported"
  | "dnc_scrub_lookups"
  | "consent_cert_claims";

export type OutboundLimitSnapshot = {
  key: OutboundLimitKey;
  label: string;
  usage: number;
  limit: number | null;
  hardCap: boolean;
  allowed: boolean;
};

export class OutboundLimitError extends Error {
  constructor(
    public readonly limitKey: OutboundLimitKey,
    public readonly usage: number,
    public readonly limit: number,
    /** What the refused action asked for; 1 for an invite or an activation. */
    public readonly requested = 1,
  ) {
    super(`OUTBOUND_LIMIT_REACHED:${limitKey}:${usage}:${limit}`);
    this.name = "OutboundLimitError";
  }
}

const METER_KEYS: Record<string, string> = {
  monthly_leads_imported: "monthly_leads_imported",
  dnc_scrub_lookups: "dnc_lookups",
  consent_cert_claims: "consent_cert_claims",
};

const LABELS: Record<OutboundLimitKey, string> = {
  max_setter_seats: "setter seats",
  max_active_campaigns: "active campaigns",
  monthly_leads_imported: "leads imported this month",
  dnc_scrub_lookups: "DNC scrub lookups",
  consent_cert_claims: "consent certificate claims",
};

async function countRows(table: string, tenantId: string, column: string, value: string) {
  type CountQuery = PromiseLike<{ count: number | null; error: { message: string } | null }> & { eq(column: string, value: string): CountQuery };
  // Compatibility tables do not share a synthetic `id` column: tenant_users is keyed by
  // (tenant_id, user_id), while campaign tables typically use id. `count(*)` is valid for both
  // shapes and keeps the limit check independent of a physical primary-key name.
  const { count, error } = await (getSupabaseServiceClient() as unknown as { from(name: string): { select(columns: string, options?: { count?: "exact"; head?: boolean }): CountQuery } }).from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId).eq(column, value);
  if (error) throw new Error(`Could not calculate ${table} usage: ${error.message}`);
  return count ?? 0;
}

/** Setters holding a seat, by the one seat rule (lib/tenantTeam/seats.ts): a deactivated setter holds none. */
async function heldSetterSeats(tenantId: string) {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_users")
    .select("accepted_at, users!tenant_users_user_id_fkey(status)")
    .eq("tenant_id", tenantId)
    .eq("role", "setter" as never);
  if (error) throw new Error(`Could not calculate tenant_users usage: ${error.message}`);
  return ((data ?? []) as unknown as Array<{ accepted_at: string | null; users: { status: string } | null }>).filter((row) => heldSeat({ status: row.users?.status, acceptedAt: row.accepted_at })).length;
}

async function usageFor(tenantId: string, key: OutboundLimitKey) {
  if (key === "max_setter_seats") return heldSetterSeats(tenantId);
  if (key === "max_active_campaigns") return countRows("tenant_campaigns", tenantId, "status", "active");
  return 0;
}

/**
 * Usage and cap for one limit, LIVE. A metered limit is read from check_meter_capacity (qty 0): the
 * period's usage_totals row and the allowance the database enforces (plan, add-ons, grants), not the
 * entitlement snapshot's `meters[...].used`, which is only as fresh as the last refresh. The snapshot
 * quoted 3,650 while the database held 3,661 (LA-2.22-1), so a 403 and a meter disagreed with the
 * figure that actually refused the import. The two count limits are counted from their rows.
 */
async function liveLimit(tenantId: string, key: OutboundLimitKey, entitlement: Awaited<ReturnType<typeof getEntitlement>>) {
  const meterKey = METER_KEYS[key];
  if (!meterKey) {
    const limit = key === "max_setter_seats" ? entitlement.limits.max_setter_seats ?? null : entitlement.limits.max_active_campaigns ?? null;
    return { usage: await usageFor(tenantId, key), limit, hardCap: true };
  }
  const meter = entitlement.meters[meterKey];
  try {
    const live = await checkMeterCapacity(tenantId, meterKey, 0);
    return { usage: Number(live.used ?? 0), limit: live.included ?? null, hardCap: Boolean(live.hard_cap) };
  } catch {
    // The capacity RPC failing is not a reason to hide the meter: fall back to the snapshot.
    return { usage: meter?.used ?? 0, limit: meter?.included ?? null, hardCap: Boolean(meter?.hard_cap) };
  }
}

export async function outboundLimitSnapshot(tenantId: string): Promise<OutboundLimitSnapshot[]> {
  const entitlement = await getEntitlement(tenantId);
  const keys: OutboundLimitKey[] = ["max_setter_seats", "max_active_campaigns", "monthly_leads_imported", "dnc_scrub_lookups", "consent_cert_claims"];
  return Promise.all(keys.map(async (key) => {
    const { usage, limit, hardCap } = await liveLimit(tenantId, key, entitlement);
    return { key, label: LABELS[key], usage, limit, hardCap, allowed: !hardCap || limit === null || usage < limit };
  }));
}

/** Server-side check used by every outbound mutation. The caller never supplies the cap. */
export async function assertOutboundLimit(tenantId: string, key: OutboundLimitKey, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Outbound limit quantity must be a positive integer");
  const entitlement = await getEntitlement(tenantId);
  const meterKey = METER_KEYS[key];
  if (!meterKey) {
    const { usage, limit } = await liveLimit(tenantId, key, entitlement);
    if (limit !== null && usage + quantity > limit) throw new OutboundLimitError(key, usage, limit, quantity);
    return;
  }
  // A metered action is judged by the database's own check, with the quantity asked for: the
  // atomic catalog-side hard cap, and the same live usage the 403 then quotes.
  const check = await checkMeterCapacity(tenantId, meterKey, quantity);
  if (!check.allowed && check.included !== null) throw new OutboundLimitError(key, Number(check.used ?? 0), check.included, quantity);
}

export async function recordOutboundUsage(tenantId: string, key: OutboundLimitKey, quantity: number, idempotencyKey: string, ref?: string) {
  const meterKey = METER_KEYS[key];
  if (!meterKey || quantity < 1) return null;
  return recordUsage({ tenantId, meterKey, qty: quantity, idempotencyKey, ref });
}

export function outboundLimitResponse(error: unknown) {
  if (!(error instanceof OutboundLimitError)) return null;
  const n = (value: number) => value.toLocaleString("en-US");
  const label = LABELS[error.limitKey];
  // At the cap the sentence names the limit and the usage. Below it (a 1,351-row import with 1,339
  // left) "has reached" would be untrue, so it says what the request would have taken it to.
  const message = error.usage >= error.limit
    ? `Your plan has reached its limit of ${n(error.limit)} ${label} (${n(error.usage)} of ${n(error.limit)} used). Upgrade to continue.`
    : `Your plan allows ${n(error.limit)} ${label} and ${n(error.usage)} are used, so ${n(error.requested)} more would go over by ${n(error.usage + error.requested - error.limit)}. Upgrade to continue.`;
  return {
    error: message,
    code: "limit_reached",
    limitKey: error.limitKey,
    usage: error.usage,
    limit: error.limit,
    requested: error.requested,
    upgrade: true,
  };
}

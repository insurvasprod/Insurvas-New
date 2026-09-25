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

export async function outboundLimitSnapshot(tenantId: string): Promise<OutboundLimitSnapshot[]> {
  const entitlement = await getEntitlement(tenantId);
  const keys: OutboundLimitKey[] = ["max_setter_seats", "max_active_campaigns", "monthly_leads_imported", "dnc_scrub_lookups", "consent_cert_claims"];
  return Promise.all(keys.map(async (key) => {
    const meterKey = METER_KEYS[key];
    const meter = meterKey ? entitlement.meters[meterKey] : undefined;
    const limit = key === "max_setter_seats" ? entitlement.limits.max_setter_seats ?? null
      : key === "max_active_campaigns" ? entitlement.limits.max_active_campaigns ?? null
      : meter?.included ?? null;
    const usage = key === "max_setter_seats" || key === "max_active_campaigns"
      ? await usageFor(tenantId, key)
      : meter?.used ?? 0;
    const hardCap = key.startsWith("max_") || Boolean(meter?.hard_cap);
    return { key, label: LABELS[key], usage, limit, hardCap, allowed: !hardCap || limit === null || usage < limit };
  }));
}

/** Server-side check used by every outbound mutation. The caller never supplies the cap. */
export async function assertOutboundLimit(tenantId: string, key: OutboundLimitKey, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("Outbound limit quantity must be a positive integer");
  const entitlement = await getEntitlement(tenantId);
  const meterKey = METER_KEYS[key];
  const meter = meterKey ? entitlement.meters[meterKey] : undefined;
  const limit = key === "max_setter_seats" ? entitlement.limits.max_setter_seats ?? null
    : key === "max_active_campaigns" ? entitlement.limits.max_active_campaigns ?? null
    : meter?.included ?? null;
  const usage = key === "max_setter_seats" || key === "max_active_campaigns" ? await usageFor(tenantId, key) : meter?.used ?? 0;
  if (limit !== null && usage + quantity > limit) throw new OutboundLimitError(key, usage, limit);
  // The metering RPC is the atomic catalog-side hard-cap check for metered actions. The cap shown
  // to the agent still came from the entitlement above; this second check closes stale-cache and
  // concurrent-request gaps at the database boundary.
  if (meterKey) {
    const check = await checkMeterCapacity(tenantId, meterKey, quantity);
    if (!check.allowed && check.included !== null) throw new OutboundLimitError(key, check.used, check.included);
  }
}

export async function recordOutboundUsage(tenantId: string, key: OutboundLimitKey, quantity: number, idempotencyKey: string, ref?: string) {
  const meterKey = METER_KEYS[key];
  if (!meterKey || quantity < 1) return null;
  return recordUsage({ tenantId, meterKey, qty: quantity, idempotencyKey, ref });
}

export function outboundLimitResponse(error: unknown) {
  if (!(error instanceof OutboundLimitError)) return null;
  return {
    error: `Your plan has reached ${LABELS[error.limitKey]} (${error.usage.toLocaleString("en-US")} of ${error.limit.toLocaleString("en-US")}). Upgrade to continue.`,
    code: "limit_reached",
    limitKey: error.limitKey,
    usage: error.usage,
    limit: error.limit,
    upgrade: true,
  };
}

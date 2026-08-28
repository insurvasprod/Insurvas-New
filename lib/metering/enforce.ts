import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type CapacityCheck = {
  allowed: boolean;
  used: number;
  included: number | null;
  hard_cap: boolean;
  pct_used: number | null;
  reason: "ok" | "near_cap" | "over_cap" | "unlimited" | "not_metered" | "no_subscription" | "no_allowance";
};

/**
 * Asks whether a tenant may consume more of a meter. Server-side by design — SA-2.5 is explicit
 * that hiding a button is not enforcement.
 *
 * The metering counterpart to requireFeature(): every metered action calls this BEFORE acting.
 */
export async function checkMeterCapacity(
  tenantId: string,
  meterKey: string,
  qty = 1,
): Promise<CapacityCheck> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("check_meter_capacity", {
    p_tenant_id: tenantId,
    p_meter_key: meterKey,
    p_qty: qty,
  });

  if (error) throw new Error(`Capacity check failed for ${meterKey}: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  return row as unknown as CapacityCheck;
}

export type UsageRecord = {
  recorded: boolean;
  new_total: number;
  billing_period_start: string;
};

/**
 * Records usage exactly once. `idempotencyKey` must be stable for the underlying real-world
 * event (a call id, a webhook delivery id) — a retry with the same key is a no-op rather than a
 * double charge, which is non-negotiable in billing.
 *
 * Pass a negative qty to correct an over-count; events are never edited or deleted.
 */
export async function recordUsage(params: {
  tenantId: string;
  meterKey: string;
  qty: number;
  idempotencyKey: string;
  ref?: string;
}): Promise<UsageRecord> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("record_usage", {
    p_tenant_id: params.tenantId,
    p_meter_key: params.meterKey,
    p_qty: params.qty,
    p_idempotency_key: params.idempotencyKey,
    p_ref: params.ref ?? null,
  });

  if (error) throw new Error(`Could not record usage for ${params.meterKey}: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  return row as unknown as UsageRecord;
}

/**
 * Check-then-record for a metered action.
 *
 * Returns `{ allowed: false }` without recording when the tenant is at a hard cap, so the caller
 * can refuse the action. Note the check and the record are two statements — a burst of parallel
 * calls could each pass the check before any records. Acceptable here (the overshoot is bounded
 * by concurrency and bills as overage in SA-3); revisit if a meter ever needs a strict ceiling.
 */
export async function consumeMeter(params: {
  tenantId: string;
  meterKey: string;
  qty: number;
  idempotencyKey: string;
  ref?: string;
}): Promise<{ allowed: boolean; check: CapacityCheck; record?: UsageRecord }> {
  const check = await checkMeterCapacity(params.tenantId, params.meterKey, params.qty);
  if (!check.allowed) return { allowed: false, check };

  const record = await recordUsage(params);
  return { allowed: true, check, record };
}

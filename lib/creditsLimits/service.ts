import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { createCustomInvoice } from "@/lib/invoices/custom";
import { CREDIT_METER_KEYS, type CreditMeterKey, type CreditPack, type CreditTenant, type MeterPricing, type UsageMonitorRow } from "./constants";

type CreditPackInput = {
  name: string;
  meter_key: CreditMeterKey;
  quantity: number;
  price_cents: number;
  is_active?: boolean;
};

export type CreditsLimitsData = {
  packs: CreditPack[];
  pricing: MeterPricing[];
  monitor: UsageMonitorRow[];
  tenants: CreditTenant[];
};

export async function listCreditPacks(): Promise<CreditPack[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("credit_packs")
    .select("id, name, meter_key, quantity, price_cents, is_active, created_at, updated_at")
    .order("is_active", { ascending: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as CreditPack[];
}

export async function listMeterPricing(): Promise<MeterPricing[]> {
  const supabase = getSupabaseServiceClient();
  const [{ data: meters, error: metersError }, { data: rows, error: pricingError }, { data: vendors }] = await Promise.all([
    supabase.from("meters").select("meter_key").in("meter_key", [...CREDIT_METER_KEYS]).order("sort_order"),
    supabase.from("meter_pricing").select("meter_key, cost_cents, sell_cents, default_included, updated_at"),
    supabase.from("compliance_vendors").select("cost_per_lookup_cents").eq("vendor_type", "dnc_scrub").eq("is_enabled", true),
  ]);
  if (metersError || pricingError) throw new Error(metersError?.message ?? pricingError?.message ?? "Could not load meter pricing");

  const pricingByMeter = new Map((rows ?? []).map((row) => [row.meter_key, row]));
  const vendorCosts = (vendors ?? []).map((vendor) => vendor.cost_per_lookup_cents).filter((cost): cost is number => typeof cost === "number");
  return (meters ?? []).flatMap((meter) => {
    const row = pricingByMeter.get(meter.meter_key);
    if (!row) return [];
    const fromVendor = meter.meter_key === "dnc_lookups" && vendorCosts.length > 0;
    return [{
      meter_key: meter.meter_key as CreditMeterKey,
      cost_cents: fromVendor ? Math.min(...vendorCosts) : row.cost_cents,
      sell_cents: row.sell_cents,
      default_included: row.default_included,
      cost_source: fromVendor ? "compliance_vendor" : "configured",
      updated_at: row.updated_at,
    } satisfies MeterPricing];
  });
}

export async function listUsageMonitor(over80 = false): Promise<UsageMonitorRow[]> {
  const supabase = getSupabaseServiceClient();
  const rows: UsageMonitorRow[] = [];
  // PostgREST caps a single response at 1,000 rows. The monitor is intentionally a complete
  // tenant×meter grid, so page the one SQL query result rather than silently dropping tenants.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.rpc("admin_usage_monitor", { p_over_80: over80 }).range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as UsageMonitorRow[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export async function listCreditTenants(): Promise<CreditTenant[]> {
  const { data, error } = await getSupabaseServiceClient().from("tenants").select("id, name, status").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as CreditTenant[];
}

export async function getCreditsLimitsData(over80 = false): Promise<CreditsLimitsData> {
  const [packs, pricing, monitor, tenants] = await Promise.all([
    listCreditPacks(),
    listMeterPricing(),
    listUsageMonitor(over80),
    listCreditTenants(),
  ]);
  return { packs, pricing, monitor, tenants };
}

export async function createCreditPack(input: CreditPackInput): Promise<CreditPack> {
  const { data, error } = await getSupabaseServiceClient()
    .from("credit_packs")
    .insert(input)
    .select("id, name, meter_key, quantity, price_cents, is_active, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data as CreditPack;
}

export async function updateCreditPack(id: string, input: Partial<CreditPackInput>): Promise<CreditPack> {
  const { data, error } = await getSupabaseServiceClient()
    .from("credit_packs")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, name, meter_key, quantity, price_cents, is_active, created_at, updated_at")
    .single();
  if (error) throw new Error(error.message);
  return data as CreditPack;
}

export async function grantCredits(input: { tenant_id: string; meter_key: CreditMeterKey; quantity: number; reason: string; granted_by: string }): Promise<{ id: string }> {
  const { data, error } = await getSupabaseServiceClient()
    .from("credit_grants")
    .insert(input)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string };
}

export async function updateMeterPricing(input: { meter_key: CreditMeterKey; cost_cents?: number; sell_cents: number; default_included: number | null; updated_by: string }): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const patch: { cost_cents?: number; sell_cents: number; default_included: number | null; updated_at: string; updated_by: string } = {
    sell_cents: input.sell_cents,
    default_included: input.default_included,
    updated_at: new Date().toISOString(),
    updated_by: input.updated_by,
  };
  if (input.cost_cents !== undefined) patch.cost_cents = input.cost_cents;
  const { error } = await supabase.from("meter_pricing").update(patch).eq("meter_key", input.meter_key);
  if (error) throw new Error(error.message);
}

export async function purchaseCreditPack(input: {
  packId: string;
  tenantId: string;
  subscriptionId: string | null;
  quantity: number;
  reason: string;
  createdBy: string;
}) {
  const { data: pack, error } = await getSupabaseServiceClient()
    .from("credit_packs")
    .select("id, name, meter_key, quantity, price_cents, is_active")
    .eq("id", input.packId)
    .maybeSingle<Pick<CreditPack, "id" | "name" | "meter_key" | "quantity" | "price_cents" | "is_active">>();
  if (error) throw new Error(error.message);
  if (!pack || !pack.is_active) throw new Error("That credit pack is no longer active");
  if (pack.price_cents <= 0) throw new Error("A free pack does not need an invoice");

  const amountCents = pack.price_cents * input.quantity;
  if (!Number.isSafeInteger(amountCents) || amountCents > 2_000_000_000) {
    throw new Error("The requested pack quantity is too large for one invoice");
  }
  const result = await createCustomInvoice({
    tenantId: input.tenantId,
    subscriptionId: input.subscriptionId,
    reason: input.reason,
    dueAt: null,
    createdBy: input.createdBy,
    lines: [{
      kind: "addon",
      label: `${pack.name} (${pack.quantity.toLocaleString("en-US")} ${pack.meter_key.replaceAll("_", " ")})`,
      quantity: input.quantity,
      unit_cents: pack.price_cents,
      amount_cents: amountCents,
    }],
  });
  return { ...result, packName: pack.name, meterKey: pack.meter_key, packQuantity: pack.quantity * input.quantity };
}

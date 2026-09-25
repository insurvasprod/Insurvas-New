import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ProductRow } from "@/lib/products/constants";
import type { CarrierRow } from "./constants";
import { isPendingSchema, SchemaPendingError } from "./schemaGap";
export { resolveCommissionRate } from "./resolve";

export type TenantCarrierRow = { id: string; tenant_id: string; carrier_id: string; contract_level_bp: number; writing_number: string; effective_from: string; is_active: boolean; created_at: string };
export type CommissionScheduleRow = import("./service-types").CommissionScheduleRow;
export type AdvanceRuleRow = { id: string; tenant_id: string; carrier_id: string; product_code: string; advance_months: number; advance_pct_bp: number; clawback_months: number; clawback_type: "full" | "prorated"; effective_from: string; created_at: string };
export type CarrierRequirementRow = { carrier_id: string; requires_eo: boolean };
export type CarrierLibrarySnapshot = {
  carriers: CarrierRow[];
  products: ProductRow[];
  tenantCarriers: TenantCarrierRow[];
  commissionSchedules: CommissionScheduleRow[];
  advanceRules: AdvanceRuleRow[];
  /** Which carriers require E&O in force (migration 20260924220100). Empty before it. */
  carrierRequirements: CarrierRequirementRow[];
  /** False until migration 20260924220100 is applied: the requirement cannot be recorded yet. */
  requirementsAvailable: boolean;
};

const SCHEDULE_COLUMNS = "id, tenant_id, carrier_id, product_code, contract_level_bp, policy_year, rate_bp, effective_from, created_at";

/** Reads applies_onward when migration 20260924100100 is in; without it every row is closed-ended. */
async function readSchedules(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  const withOnward = await supabase.from("commission_schedules").select(`${SCHEDULE_COLUMNS}, applies_onward`).eq("tenant_id", tenantId).order("effective_from", { ascending: false });
  if (!withOnward.error || !isPendingSchema(withOnward.error)) return withOnward;
  return supabase.from("commission_schedules").select(SCHEDULE_COLUMNS).eq("tenant_id", tenantId).order("effective_from", { ascending: false });
}

export async function getCarrierLibrary(tenantId: string): Promise<CarrierLibrarySnapshot> {
  const supabase = getSupabaseServiceClient();
  const [carriers, products, tenantCarriers, schedules, rules, requirements] = await Promise.all([
    // The live project also has organization-owned carrier rows. LA-0 uses only the platform
    // library rows, represented by a null organization_id, so one tenant cannot see another
    // organization's private carrier configuration.
    supabase.from("carriers").select("id, code, name, is_active, sort_order, created_at, updated_at").is("organization_id", null).eq("is_active", true).order("sort_order").order("name"),
    supabase.from("products").select("id, code, name, category, description, is_active, sort_order, created_at, updated_at").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("tenant_carriers").select("id, tenant_id, carrier_id, contract_level_bp, writing_number, effective_from, is_active, created_at").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
    readSchedules(tenantId),
    supabase.from("advance_rules").select("id, tenant_id, carrier_id, product_code, advance_months, advance_pct_bp, clawback_months, clawback_type, effective_from, created_at").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
    readRequirements(tenantId),
  ]);
  const error = [carriers, products, tenantCarriers, schedules, rules].find((result) => result.error)?.error;
  if (error) throw new Error(`Could not load carrier library: ${error.message}`);
  return { carriers: (carriers.data ?? []) as CarrierRow[], products: (products.data ?? []) as ProductRow[], tenantCarriers: (tenantCarriers.data ?? []) as TenantCarrierRow[], commissionSchedules: (schedules.data ?? []) as CommissionScheduleRow[], advanceRules: (rules.data ?? []) as AdvanceRuleRow[], carrierRequirements: requirements.rows, requirementsAvailable: requirements.available };
}

/** Garnish: a missing table (migration 20260924220100 not applied) reads as "nothing recorded yet". */
async function readRequirements(tenantId: string): Promise<{ rows: CarrierRequirementRow[]; available: boolean }> {
  const { data, error } = await getSupabaseServiceClient().from("tenant_carrier_requirements" as never).select("carrier_id, requires_eo").eq("tenant_id" as never, tenantId as never);
  const failure = error as { message: string; code?: string } | null;
  if (failure && isPendingSchema(failure)) return { rows: [], available: false };
  if (failure) throw new Error(`Could not load carrier requirements: ${failure.message}`);
  return { rows: (data ?? []) as unknown as CarrierRequirementRow[], available: true };
}

/** Records whether a carrier requires E&O in force. SchemaPendingError (503) before migration 20260924220100. */
export async function saveCarrierRequirement(tenantId: string, actorId: string, input: { carrier_id: string; requires_eo: boolean }): Promise<CarrierRequirementRow> {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_carrier_requirements" as never)
    .upsert({ tenant_id: tenantId, carrier_id: input.carrier_id, requires_eo: input.requires_eo, updated_at: new Date().toISOString(), updated_by: actorId } as never, { onConflict: "tenant_id,carrier_id" })
    .select("carrier_id, requires_eo")
    .single();
  const failure = error as { message: string; code?: string } | null;
  if (failure && isPendingSchema(failure)) throw new SchemaPendingError();
  if (failure || !data) throw new Error(failure?.message ?? "Could not save the carrier requirement");
  return data as unknown as CarrierRequirementRow;
}

export async function saveTenantCarrier(tenantId: string, input: { carrier_id: string; contract_level_bp: number; writing_number: string; effective_from: string }) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_tenant_carrier", { p_tenant_id: tenantId, p_carrier_id: input.carrier_id, p_contract_level_bp: input.contract_level_bp, p_writing_number: input.writing_number, p_effective_from: input.effective_from }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save carrier contract");
  return data as TenantCarrierRow;
}

export async function saveCommissionSchedule(tenantId: string, input: { carrier_id: string; product_code: string; contract_level_bp: number; policy_year: number; rate_bp: number; effective_from: string; applies_onward?: boolean }) {
  const supabase = getSupabaseServiceClient();
  const args = { p_tenant_id: tenantId, p_carrier_id: input.carrier_id, p_product_code: input.product_code, p_contract_level_bp: input.contract_level_bp, p_policy_year: input.policy_year, p_rate_bp: input.rate_bp, p_effective_from: input.effective_from };
  // The eight-argument overload (20260924100100) also records "this year and every year after". It
  // is always tried first so re-saving a year can clear the flag; a database without it falls back
  // to the original seven-argument save — unless the caller asked for an open-ended year, which that
  // save cannot store.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the overload is not in the shared generated types yet
  const withOnward = await (supabase.rpc.bind(supabase) as any)("save_commission_schedule", { ...args, p_applies_onward: input.applies_onward === true }).single();
  if (!withOnward.error && withOnward.data) return withOnward.data as CommissionScheduleRow;
  if (withOnward.error && isPendingSchema(withOnward.error)) {
    if (input.applies_onward) throw new SchemaPendingError();
    const { data, error } = await supabase.rpc("save_commission_schedule", args).single();
    if (error || !data) throw new Error(error?.message ?? "Could not save commission schedule");
    return data as CommissionScheduleRow;
  }
  throw new Error(withOnward.error?.message ?? "Could not save commission schedule");
}

export async function saveAdvanceRule(tenantId: string, input: { carrier_id: string; product_code: string; advance_months: number; advance_pct_bp: number; clawback_months: number; clawback_type: "full" | "prorated"; effective_from: string }) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_advance_rule", { p_tenant_id: tenantId, p_carrier_id: input.carrier_id, p_product_code: input.product_code, p_advance_months: input.advance_months, p_advance_pct_bp: input.advance_pct_bp, p_clawback_months: input.clawback_months, p_clawback_type: input.clawback_type, p_effective_from: input.effective_from }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save advance rule");
  return data as AdvanceRuleRow;
}

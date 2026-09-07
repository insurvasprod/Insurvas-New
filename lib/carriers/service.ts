import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ProductRow } from "@/lib/products/constants";
import type { CarrierRow } from "./constants";
export { resolveCommissionRate } from "./resolve";

export type TenantCarrierRow = { id: string; tenant_id: string; carrier_id: string; contract_level_bp: number; writing_number: string; effective_from: string; is_active: boolean; created_at: string };
export type CommissionScheduleRow = import("./service-types").CommissionScheduleRow;
export type AdvanceRuleRow = { id: string; tenant_id: string; carrier_id: string; product_code: string; advance_months: number; advance_pct_bp: number; clawback_months: number; clawback_type: "full" | "prorated"; effective_from: string; created_at: string };
export type CarrierLibrarySnapshot = { carriers: CarrierRow[]; products: ProductRow[]; tenantCarriers: TenantCarrierRow[]; commissionSchedules: CommissionScheduleRow[]; advanceRules: AdvanceRuleRow[] };

export async function getCarrierLibrary(tenantId: string): Promise<CarrierLibrarySnapshot> {
  const supabase = getSupabaseServiceClient();
  const [carriers, products, tenantCarriers, schedules, rules] = await Promise.all([
    supabase.from("carriers").select("id, code, name, is_active, sort_order, created_at, updated_at").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("products").select("id, code, name, category, description, is_active, sort_order, created_at, updated_at").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("tenant_carriers").select("id, tenant_id, carrier_id, contract_level_bp, writing_number, effective_from, is_active, created_at").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
    supabase.from("commission_schedules").select("id, tenant_id, carrier_id, product_code, contract_level_bp, policy_year, rate_bp, effective_from, created_at").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
    supabase.from("advance_rules").select("id, tenant_id, carrier_id, product_code, advance_months, advance_pct_bp, clawback_months, clawback_type, effective_from, created_at").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
  ]);
  const error = [carriers, products, tenantCarriers, schedules, rules].find((result) => result.error)?.error;
  if (error) throw new Error(`Could not load carrier library: ${error.message}`);
  return { carriers: (carriers.data ?? []) as CarrierRow[], products: (products.data ?? []) as ProductRow[], tenantCarriers: (tenantCarriers.data ?? []) as TenantCarrierRow[], commissionSchedules: (schedules.data ?? []) as CommissionScheduleRow[], advanceRules: (rules.data ?? []) as AdvanceRuleRow[] };
}

export async function saveTenantCarrier(tenantId: string, input: { carrier_id: string; contract_level_bp: number; writing_number: string; effective_from: string }) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_tenant_carrier", { p_tenant_id: tenantId, p_carrier_id: input.carrier_id, p_contract_level_bp: input.contract_level_bp, p_writing_number: input.writing_number, p_effective_from: input.effective_from }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save carrier contract");
  return data as TenantCarrierRow;
}

export async function saveCommissionSchedule(tenantId: string, input: { carrier_id: string; product_code: string; contract_level_bp: number; policy_year: number; rate_bp: number; effective_from: string }) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_commission_schedule", { p_tenant_id: tenantId, p_carrier_id: input.carrier_id, p_product_code: input.product_code, p_contract_level_bp: input.contract_level_bp, p_policy_year: input.policy_year, p_rate_bp: input.rate_bp, p_effective_from: input.effective_from }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save commission schedule");
  return data as CommissionScheduleRow;
}

export async function saveAdvanceRule(tenantId: string, input: { carrier_id: string; product_code: string; advance_months: number; advance_pct_bp: number; clawback_months: number; clawback_type: "full" | "prorated"; effective_from: string }) {
  const { data, error } = await getSupabaseServiceClient().rpc("save_advance_rule", { p_tenant_id: tenantId, p_carrier_id: input.carrier_id, p_product_code: input.product_code, p_advance_months: input.advance_months, p_advance_pct_bp: input.advance_pct_bp, p_clawback_months: input.clawback_months, p_clawback_type: input.clawback_type, p_effective_from: input.effective_from }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save advance rule");
  return data as AdvanceRuleRow;
}

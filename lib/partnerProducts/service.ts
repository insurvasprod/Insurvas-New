import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { agencyProducts } from "@/lib/products/agencyProducts";
import type { ProductConfiguration, PartnerProductConfiguration } from "./constants";

/**
 * The catalogue with what this agency sells. `is_enabled` is "sold" (Settings › Products, 2026-10-27):
 * switched on AND in the plan, from the one rule in lib/products/agencyProducts.ts, so the partner
 * pages, the portal, the affiliate form and the transfer gate all follow the same answer.
 */
export async function listTenantProducts(tenantId: string): Promise<ProductConfiguration[]> {
  return (await agencyProducts(tenantId)).map((product) => ({
    code: product.code,
    name: product.name,
    category: product.category as ProductConfiguration["category"],
    description: product.description,
    is_enabled: product.sold,
    sort_order: product.sortOrder,
  }));
}

export async function setTenantProduct(tenantId: string, productCode: string, isEnabled: boolean) {
  const { data, error } = await getSupabaseServiceClient().rpc("set_tenant_product", {
    p_tenant_id: tenantId,
    p_product_code: productCode,
    p_is_enabled: isEnabled,
  }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save tenant product setting");
  return data;
}

async function loadPartner(tenantId: string, partnerId: string) {
  const { data, error } = await getSupabaseServiceClient()
    .from("partners")
    .select("id, tenant_id, status")
    .eq("id", partnerId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(`Could not load partner: ${error.message}`);
  if (!data) throw new Error("partner_not_found");
  return data;
}

export async function listPartnerProductConfiguration(tenantId: string, partnerId: string): Promise<PartnerProductConfiguration[]> {
  await loadPartner(tenantId, partnerId);
  const [products, approvals] = await Promise.all([
    listTenantProducts(tenantId),
    getSupabaseServiceClient().from("partner_products").select("product_code").eq("partner_id", partnerId),
  ]);
  if (approvals.error) throw new Error(`Could not load partner product settings: ${approvals.error.message}`);
  const approved = new Set((approvals.data ?? []).map((row) => row.product_code));
  return products.map((product) => ({ ...product, approved: approved.has(product.code) }));
}

export async function setPartnerProductApproval(tenantId: string, partnerId: string, productCode: string, isApproved: boolean, approvedBy: string) {
  const { data, error } = await getSupabaseServiceClient().rpc("set_partner_product_approval", {
    p_tenant_id: tenantId,
    p_partner_id: partnerId,
    p_product_code: productCode,
    p_approved: isApproved,
    p_approved_by: approvedBy,
  });
  if (error || data !== true && data !== false) throw new Error(error?.message ?? "Could not save partner product approval");
  return data;
}

export async function listPartnerApprovedProducts(tenantId: string, partnerId: string) {
  const products = await listPartnerProductConfiguration(tenantId, partnerId);
  return products.filter((product) => product.is_enabled && product.approved);
}

/** The single capability check intake writers must call before inserting anything. */
export async function assertPartnerProductApproved(tenantId: string, partnerId: string, productCode: string): Promise<void> {
  const products = await listPartnerProductConfiguration(tenantId, partnerId);
  const product = products.find((item) => item.code === productCode);
  if (!product) throw new Error("product_not_found");
  if (!product.is_enabled) throw new Error("product_not_enabled");
  if (!product.approved) throw new Error("partner_product_not_approved");
}

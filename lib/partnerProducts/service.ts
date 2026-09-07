import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { fetchProducts } from "@/lib/products/queries";
import type { ProductConfiguration, PartnerProductConfiguration } from "./constants";

export async function listTenantProducts(tenantId: string): Promise<ProductConfiguration[]> {
  const [products, selected] = await Promise.all([
    fetchProducts({ includeArchived: false }),
    getSupabaseServiceClient().from("tenant_products").select("product_code, is_enabled, sort_order").eq("tenant_id", tenantId),
  ]);
  if (selected.error) throw new Error(`Could not load tenant product settings: ${selected.error.message}`);
  const settings = new Map((selected.data ?? []).map((row) => [row.product_code, row]));
  return products.map((product) => ({
    code: product.code,
    name: product.name,
    category: product.category,
    description: product.description,
    is_enabled: settings.get(product.code)?.is_enabled ?? false,
    sort_order: settings.get(product.code)?.sort_order ?? product.sort_order,
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
  const [products, selected, approvals] = await Promise.all([
    fetchProducts({ includeArchived: false }),
    getSupabaseServiceClient().from("tenant_products").select("product_code, is_enabled").eq("tenant_id", tenantId),
    getSupabaseServiceClient().from("partner_products").select("product_code").eq("partner_id", partnerId),
  ]);
  if (selected.error || approvals.error) throw new Error(`Could not load partner product settings: ${selected.error?.message ?? approvals.error?.message}`);
  const enabled = new Map((selected.data ?? []).map((row) => [row.product_code, row.is_enabled]));
  const approved = new Set((approvals.data ?? []).map((row) => row.product_code));
  return products.map((product) => ({
    code: product.code,
    name: product.name,
    category: product.category,
    description: product.description,
    is_enabled: enabled.get(product.code) ?? false,
    sort_order: product.sort_order,
    approved: approved.has(product.code),
  }));
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

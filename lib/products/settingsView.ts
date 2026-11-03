import "server-only";

import { agencyProducts, ProductNotSoldError, type AgencyProduct } from "@/lib/products/agencyProducts";
import { setTenantProduct } from "@/lib/partnerProducts/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Settings › Products (option A, owner 2026-10-27): every catalogue product with a switch, what the
 * plan does not include shown locked, and for each product the partners approved to send it, whether
 * its form is set up, and how many carriers offer it. The switch writes tenant_products through the
 * same RPC the Publishers tab used (set_tenant_product), so nothing else changes shape.
 */

export type ProductSettingsRow = AgencyProduct & {
  partners: string[];
  formReady: boolean;
  carriers: number;
};

export async function productSettingsView(tenantId: string): Promise<ProductSettingsRow[]> {
  const db = getSupabaseServiceClient();
  const [products, partners, forms, carrierRows] = await Promise.all([
    agencyProducts(tenantId),
    db.from("partners").select("id, name, status").eq("tenant_id", tenantId),
    db.from("tenant_templates").select("product_code").eq("tenant_id", tenantId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- carrier_products is not in the generated types
    (db as any).from("carrier_products").select("carrier_id, product_code, tenant_id").eq("is_active", true).or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
  ]);
  for (const result of [partners, forms, carrierRows]) if (result.error) throw new Error(`Could not load products: ${result.error.message}`);
  const partnerName = new Map((partners.data ?? []).filter((partner) => partner.status !== "offboarded").map((partner) => [partner.id as string, partner.name as string]));
  // partner_products has no tenant column: read only this agency's partners' rows.
  const approvals = partnerName.size ? await db.from("partner_products").select("partner_id, product_code").in("partner_id", [...partnerName.keys()]) : { data: [], error: null };
  const approved = new Map<string, string[]>();
  if (!approvals.error) {
    for (const row of approvals.data ?? []) {
      const name = partnerName.get(row.partner_id as string);
      if (name) approved.set(row.product_code as string, [...(approved.get(row.product_code as string) ?? []), name]);
    }
  }
  const formCodes = new Set((forms.data ?? []).map((row) => row.product_code as string));
  const carriers = new Map<string, Set<string>>();
  for (const row of (carrierRows.data ?? []) as Array<{ carrier_id: string; product_code: string | null }>) {
    const code = row.product_code as string | null;
    if (!code) continue;
    carriers.set(code, (carriers.get(code) ?? new Set()).add(row.carrier_id as string));
  }
  return products.map((product) => ({
    ...product,
    partners: (approved.get(product.code) ?? []).sort((a, b) => a.localeCompare(b)),
    formReady: formCodes.has(product.code),
    carriers: carriers.get(product.code)?.size ?? 0,
  }));
}

/** Switch a product on or off for the agency. Turning on what the plan does not include is refused. */
export async function setProductSold(tenantId: string, productCode: string, sold: boolean) {
  const product = (await agencyProducts(tenantId)).find((item) => item.code === productCode);
  if (!product) throw new ProductNotSoldError(productCode, "not_in_catalogue");
  if (sold && !product.inPlan) throw new ProductNotSoldError(productCode, "not_in_plan");
  await setTenantProduct(tenantId, productCode, sold);
  return { before: product.enabled, product };
}

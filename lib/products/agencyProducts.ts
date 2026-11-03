import "server-only";

import { getEntitlement } from "@/lib/entitlements/get";
import { fetchProducts } from "@/lib/products/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The products an agency sells (Settings › Products, owner 2026-10-27; Notion LA-1.3 + SA-4.5).
 *
 * One rule, read by every product picker and every server check: a product is sold when it is in
 * the Insurvas catalogue (active), the agency switched it on (tenant_products), and the plan includes
 * it (plan_product_access). A plan that lists no products does not narrow anything: 64 agencies on
 * 2026-10-27 had no product list on their plan, and none had a product on outside its plan.
 *
 * What already exists under a product (leads, applications, policies) keeps working when a product
 * stops being sold; only new choices are limited.
 */

export type AgencyProduct = {
  code: string;
  name: string;
  category: string;
  description: string | null;
  sortOrder: number;
  /** The agency's plan includes it (or the plan names no products). */
  inPlan: boolean;
  /** Switched on in Settings › Products. */
  enabled: boolean;
  /** In plan and switched on: what pickers offer. */
  sold: boolean;
};

export class ProductNotSoldError extends Error {
  constructor(readonly productCode: string, readonly reason: "not_in_catalogue" | "not_in_plan" | "not_sold") {
    super(reason === "not_in_catalogue" ? "That product is not in the Insurvas catalogue." : reason === "not_in_plan" ? "Your plan does not include that product." : "Your agency does not sell that product. Turn it on in Settings › Products.");
    this.name = "ProductNotSoldError";
  }
}

/** The plan's product codes, or null when the plan names none (no limit from the plan). */
async function planProductCodes(tenantId: string): Promise<Set<string> | null> {
  const entitlement = await getEntitlement(tenantId);
  if (!entitlement.plan_code) return null;
  const supabase = getSupabaseServiceClient();
  const { data: plan } = await supabase.from("plans").select("id").eq("code", entitlement.plan_code).eq("version", entitlement.plan_version ?? 1).maybeSingle();
  if (!plan) return null;
  const { data, error } = await supabase.from("plan_product_access").select("product_code").eq("plan_id", plan.id);
  if (error) throw new Error(`Could not load your plan's products: ${error.message}`);
  const codes = (data ?? []).map((row) => row.product_code as string);
  return codes.length ? new Set(codes) : null;
}

/** Every active catalogue product, with whether this agency's plan includes it and whether it is sold. */
export async function agencyProducts(tenantId: string): Promise<AgencyProduct[]> {
  const [catalogue, plan, selected] = await Promise.all([
    fetchProducts({ includeArchived: false }),
    planProductCodes(tenantId),
    getSupabaseServiceClient().from("tenant_products").select("product_code, is_enabled").eq("tenant_id", tenantId),
  ]);
  if (selected.error) throw new Error(`Could not load the products you sell: ${selected.error.message}`);
  const enabled = new Map((selected.data ?? []).map((row) => [row.product_code as string, Boolean(row.is_enabled)]));
  return catalogue.map((product) => {
    const inPlan = plan === null || plan.has(product.code);
    const on = enabled.get(product.code) ?? false;
    return { code: product.code, name: product.name, category: product.category, description: product.description ?? null, sortOrder: product.sort_order, inPlan, enabled: on, sold: inPlan && on };
  });
}

/** Only what the agency sells, in catalogue order: the list every picker offers. */
export async function soldProducts(tenantId: string): Promise<Array<Pick<AgencyProduct, "code" | "name" | "category">>> {
  return (await agencyProducts(tenantId)).filter((product) => product.sold).map(({ code, name, category }) => ({ code, name, category }));
}

export async function soldProductCodes(tenantId: string): Promise<Set<string>> {
  return new Set((await soldProducts(tenantId)).map((product) => product.code));
}

/** The server check behind every picker: refuse a new record for a product the agency does not sell. */
export async function assertSoldProduct(tenantId: string, productCode: string): Promise<void> {
  const product = (await agencyProducts(tenantId)).find((item) => item.code === productCode);
  if (!product) throw new ProductNotSoldError(productCode, "not_in_catalogue");
  if (!product.inPlan) throw new ProductNotSoldError(productCode, "not_in_plan");
  if (!product.enabled) throw new ProductNotSoldError(productCode, "not_sold");
}

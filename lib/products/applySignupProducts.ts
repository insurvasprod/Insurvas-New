import "server-only";

import { agencyProducts } from "@/lib/products/agencyProducts";
import { signupProductCodes } from "@/lib/products/signupProducts";
import { setTenantProduct } from "@/lib/partnerProducts/service";

/**
 * Switch on, in Settings › Products, what the owner said they sell at sign-up (owner 2026-11-03), for
 * agencies and individual agents alike. Within the plan only. Runs once: an agency that already has
 * any product switched on keeps its own choice, so re-saving the profile later changes nothing.
 * Returns the codes it switched on.
 */
export async function applySignupProducts(tenantId: string, productsSold: readonly string[]): Promise<string[]> {
  const products = await agencyProducts(tenantId);
  if (products.some((p) => p.enabled)) return [];
  const codes = signupProductCodes(productsSold, products).filter((code) => products.find((p) => p.code === code)?.inPlan);
  for (const code of codes) await setTenantProduct(tenantId, code, true);
  return codes;
}

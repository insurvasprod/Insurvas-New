import "server-only";

import { NextResponse } from "next/server";

import { getAgentTemplateForProduct, PRODUCT_CODE, type AgentTemplate } from "@/lib/agentTemplates/service";
import { ProductNotSoldError, soldProducts } from "@/lib/products/agencyProducts";

/** A product the agency sells with no lead form yet: nothing to read the file's columns against. */
export class ProductFormMissingError extends Error {
  constructor(readonly productName: string) {
    super(`${productName} has no lead form yet. Set one up in Settings › Form templates, then import.`);
    this.name = "ProductFormMissingError";
  }
}

/**
 * The product a lead import is for (owner 2026-10-28): one the agency sells (Settings › Products).
 * Asked for by code, it must be sold; not asked for, Term Life when the agency sells it (what every
 * import was before), otherwise the first product it sells. An agency that sells nothing is told to
 * choose its products first; a product with no lead form is told to set one up.
 */
export async function importTemplateFor(tenantId: string, userId: string, requested?: string | null): Promise<{ template: AgentTemplate; products: Array<{ code: string; name: string; category: string }> }> {
  const products = await soldProducts(tenantId);
  if (products.length === 0) throw new ProductNotSoldError(requested ?? PRODUCT_CODE, "not_sold");
  const code = requested
    ? products.some((product) => product.code === requested) ? requested : null
    : products.some((product) => product.code === PRODUCT_CODE) ? PRODUCT_CODE : products[0].code;
  if (!code) throw new ProductNotSoldError(requested ?? "", "not_sold");
  try {
    return { template: await getAgentTemplateForProduct(tenantId, userId, code), products };
  } catch (error) {
    // No platform template for the product, or the plan's form list leaves it out.
    if (error instanceof Error && /No active .* template is available|does not include/.test(error.message)) {
      throw new ProductFormMissingError(products.find((product) => product.code === code)?.name ?? code);
    }
    throw error;
  }
}

/** The answer an import route gives when the product cannot be imported; null for any other error. */
export function importProductRefusal(error: unknown): NextResponse | null {
  if (error instanceof ProductNotSoldError) return NextResponse.json({ error: error.message, code: "product_not_sold" }, { status: 409 });
  if (error instanceof ProductFormMissingError) return NextResponse.json({ error: error.message, code: "product_form_missing" }, { status: 409 });
  return null;
}

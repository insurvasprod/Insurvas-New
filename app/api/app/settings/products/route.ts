import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { ProductNotSoldError } from "@/lib/products/agencyProducts";
import { productSettingsView, setProductSold } from "@/lib/products/settingsView";
import { recordSettingsChanges } from "@/lib/settingsAudit/record";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * Settings › Products (owner 2026-10-27): which catalogue products the agency sells. Owners only.
 * GET is the page; PATCH switches one product. Every product picker reads the same answer through
 * lib/products/agencyProducts.ts, so a switch here shows everywhere on the next read.
 */
const schema = z.object({
  product_code: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/, "Choose a valid product"),
  sold: z.boolean(),
}).strict();

export async function GET() {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ products: await productSettingsView(auth.context.tenantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Your products could not be loaded." }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a product." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    const { before, product } = await setProductSold(tenantId, parsed.data.product_code, parsed.data.sold);
    if (before !== parsed.data.sold) {
      await recordSettingsChanges({ tenantId, actorId: userId, section: "products", changes: [{ key: `products.${product.code}`, label: `Sells ${product.name}`, from: before, to: parsed.data.sold }] });
      await audit({ actorType: "tenant", actorId: userId, action: parsed.data.sold ? "tenant.product_enabled" : "tenant.product_disabled", targetType: "tenant_product", targetId: `${tenantId}:${product.code}`, metadata: { tenantId, productCode: product.code, isEnabled: parsed.data.sold }, request });
    }
    return NextResponse.json({ products: await productSettingsView(tenantId) });
  } catch (error) {
    if (error instanceof ProductNotSoldError) return NextResponse.json({ error: error.message, code: error.reason }, { status: error.reason === "not_in_catalogue" ? 404 : 409 });
    return NextResponse.json({ error: "That change could not be saved. Try again." }, { status: 500 });
  }
}

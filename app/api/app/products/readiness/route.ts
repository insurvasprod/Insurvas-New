import { NextResponse } from "next/server";

import { productReadiness } from "@/lib/products/readinessServer";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * Settings › Products, round 8: what each product needs before an agent can quote it (form, carriers, health
 * questions, quote inputs) and which plans add a product the agency's plan lacks. Owners only, as the page
 * is. Read only; the switch itself stays on PATCH /api/app/settings/products.
 */
export async function GET() {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await productReadiness(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Couldn't check what each product needs." }, { status: 503 });
  }
}

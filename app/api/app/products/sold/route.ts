import { NextResponse } from "next/server";

import { soldProducts } from "@/lib/products/agencyProducts";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * The products this agency sells (Settings › Products), for every product picker in the app: Add a
 * deal, campaigns, lead routing rules, filters. Owners, agents and screeners read it (the roles that
 * reach those screens; a setter quotes and sells nothing); only the owner changes it
 * (PATCH /api/app/settings/products).
 */
export async function GET() {
  const auth = await requireTenant(["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ products: await soldProducts(auth.context.tenantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Your products could not be loaded." }, { status: 503 });
  }
}

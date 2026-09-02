import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listTenantProducts } from "@/lib/partnerProducts/service";

export async function GET() {
  const auth = await requireFeatureRole("publisher_records", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ products: await listTenantProducts(auth.context.tenantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load product settings" }, { status: 500 });
  }
}

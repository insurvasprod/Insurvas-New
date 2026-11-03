import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_VIEW_TENANTS } from "@/lib/tenants/permissions";
import { fetchCompedTenants } from "@/lib/tenants/comps";

/**
 * GET /api/admin/tenants/comped — the comped-tenants report (doc 2 §5.3): every tenant given the
 * platform free of charge, with the reason recorded when it was created, who comped it and when.
 * Read-only, so no audit row.
 */
export async function GET() {
  const auth = await requireAdminRole(CAN_VIEW_TENANTS);
  if (auth instanceof NextResponse) return auth;

  try {
    const comped = await fetchCompedTenants();
    if (comped === null) {
      return NextResponse.json({ error: "The comped-tenants report needs migration 20261015530000" }, { status: 503 });
    }
    return NextResponse.json({ comped, total: comped.length }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load comped tenants" }, { status: 500 });
  }
}

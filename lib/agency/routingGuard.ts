import "server-only";
import { NextResponse } from "next/server";

import { isAgencyTenant } from "./audience";

/**
 * AG-0.10 · in an agency the leads are the agency's and the owner (or an admin, whose base role is owner)
 * routes them. A producer works the leads assigned to him in his own queue; he does not route the agency's
 * leads or browse its pool. Returns null when allowed. Its own module, so a route that only needs the guard
 * does not import the pool reader.
 */
export async function refuseRoutingInAgency(context: { tenantId: string; role: string }): Promise<NextResponse | null> {
  if (context.role === "owner") return null;
  if (!(await isAgencyTenant(context.tenantId))) return null;
  return NextResponse.json(
    { error: "In an agency the owner or an admin routes leads. Your assigned leads are in your queue.", code: "agency_routing_owner_only" },
    { status: 403 },
  );
}

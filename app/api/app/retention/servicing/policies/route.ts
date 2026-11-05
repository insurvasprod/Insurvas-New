import { NextResponse, type NextRequest } from "next/server";

import { scopeFor } from "@/lib/agency/visibility";
import { searchPolicies } from "@/lib/retention/servicingStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-5.4 · New request, step 1 (SvA 2026-11-05): find the policy by client name, phone or policy number.
 * GET `?q=`; at most 20 policies this session may open a request on (a producer: their own; a narrowed agency
 * session: its producers'). Read only; gated as the servicing route is.
 */
const ROLES = ["owner", "producer", "retention"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("payment_repair", ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const q = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  const { tenantId, userId, role } = auth.context;
  try {
    const policies = await searchPolicies({ tenantId, userId, role, scope: await scopeFor(auth.context) }, q);
    return NextResponse.json({ policies });
  } catch (error) {
    console.error("[servicing] policy search:", error);
    return NextResponse.json({ error: "The policies could not be searched" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listApplicationRows } from "@/lib/applications/lists";
import { scopeFor } from "@/lib/agency/visibility";

/** LA-3 · the Applications list. No sensitive value is in this payload, masked or otherwise. */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  try {
    // AG-0.5 · a narrow session sees only the applications on cases its visible producers opened.
    return NextResponse.json({ applications: await listApplicationRows(actor.tenantId, await scopeFor(auth.context)) });
  } catch (error) {
    return failure(error);
  }
}

import { NextResponse } from "next/server";

import { failure } from "@/lib/applications/http";
import { listGrantActivity } from "@/lib/extension/grants";
import { actorOf, NO_STORE } from "@/lib/extension/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";

/** LA-3.12 · recent grants (an owner sees the agency's, a producer their own) and the carrier sites. */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("carrier_extension", ["owner", "producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  try {
    const [activity, scope] = await Promise.all([listGrantActivity(actorOf(auth, request)), scopeFor(auth.context)]);
    // AG-0.5: the service already narrows a non-owner to their own grants; a narrow session inside an
    // agency is held to that here as well, so no other producer's grant (client name, carrier, reads)
    // can reach it whatever the service does. The carrier sites are the agency's configuration.
    const grants = scope === null ? activity.grants : activity.grants.filter((grant) => grant.mine);
    return NextResponse.json({ ...activity, grants }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

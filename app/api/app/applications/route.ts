import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listApplicationRows } from "@/lib/applications/lists";

/** LA-3 · the Applications list. No sensitive value is in this payload, masked or otherwise. */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  try {
    return NextResponse.json({ applications: await listApplicationRows(actor.tenantId) });
  } catch (error) {
    return failure(error);
  }
}

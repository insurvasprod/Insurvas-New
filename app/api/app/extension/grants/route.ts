import { NextResponse } from "next/server";

import { failure } from "@/lib/applications/http";
import { listGrantActivity } from "@/lib/extension/grants";
import { actorOf, NO_STORE } from "@/lib/extension/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-3.12 · recent grants (an owner sees the agency's, a producer their own) and the carrier sites. */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("carrier_extension", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listGrantActivity(actorOf(auth, request)), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

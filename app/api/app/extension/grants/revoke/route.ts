import { NextResponse } from "next/server";

import { body, failure } from "@/lib/applications/http";
import { revokeGrants } from "@/lib/extension/grants";
import { actorOf } from "@/lib/extension/http";
import { revokeSchema } from "@/lib/extension/schemas";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.12 · revoke. `{ grant_id }` revokes one (a producer only their own); `{}` revokes every live
 * grant in the agency and is owner-only. The extension's next request is refused.
 */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("carrier_extension", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, revokeSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await revokeGrants(actorOf(auth, request), input.grant_id ?? null));
  } catch (error) {
    return failure(error);
  }
}

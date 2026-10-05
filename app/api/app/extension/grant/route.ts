import { NextResponse } from "next/server";

import { body, failure } from "@/lib/applications/http";
import { mintGrant } from "@/lib/extension/grants";
import { actorOf, NO_STORE } from "@/lib/extension/http";
import { grantSchema } from "@/lib/extension/schemas";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.12 · open a grant: the extension may read ONE application's fields on ONE carrier site for
 * 60 minutes. Owner and producer, `carrier_extension`, application `ready`, carrier with a portal
 * origin. The token goes back to the page, which hands it to the extension by postMessage only.
 */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("carrier_extension", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, grantSchema);
  if (input instanceof NextResponse) return input;
  try {
    const grant = await mintGrant(actorOf(auth, request), { applicationId: input.application_id, carrierId: input.carrier_id });
    return NextResponse.json(grant, { status: 201, headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

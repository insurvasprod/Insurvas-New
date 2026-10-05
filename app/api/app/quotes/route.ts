import { NextResponse } from "next/server";

import { actorOf, failure } from "@/lib/applications/http";
import { listQuoteRows } from "@/lib/applications/lists";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.5 · every quote the tenant has saved, discarded ones included, with its client, case,
 * carrier and product. No commission, contract level or appointment figure is in this payload.
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("quoting", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  try {
    return NextResponse.json({ quotes: await listQuoteRows(actor.tenantId) });
  } catch (error) {
    return failure(error);
  }
}

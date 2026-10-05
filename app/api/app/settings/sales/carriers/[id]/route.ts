import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { carrierFactsSchema } from "@/lib/salesSettings/carrierSchemas";
import { saveCarrierFacts } from "@/lib/salesSettings/carriers";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.17 · the agency's portal origin, reference pattern and billing descriptor for one platform
 * carrier (tenant_carrier_settings). The platform carrier row is never written. Owners only.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That carrier could not be found." }, { status: 404 });
  const input = await body(request, carrierFactsSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await saveCarrierFacts(actorOf(auth, request), id, input));
  } catch (error) {
    return failure(error);
  }
}

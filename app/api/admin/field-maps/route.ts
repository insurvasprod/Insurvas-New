import { NextResponse } from "next/server";

import { body, failure } from "@/lib/applications/http";
import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { adminScopeFor, NO_STORE } from "@/lib/extension/http";
import { carrierOptions, createMap, listMaps } from "@/lib/extension/maps";
import { createMapSchema } from "@/lib/extension/schemas";

/**
 * LA-3.13 · staff review of the PLATFORM field maps (tenant_id null) and their misses. Carriers
 * access rule (the maps belong to the carrier library).
 */
export async function GET(request: Request) {
  const scope = adminScopeFor(await resolveAdminContext(), request);
  if (scope instanceof NextResponse) return scope;
  try {
    const [maps, carriers] = await Promise.all([listMaps(scope), carrierOptions(scope)]);
    return NextResponse.json({ maps, carriers }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const scope = adminScopeFor(await resolveAdminContext(), request);
  if (scope instanceof NextResponse) return scope;
  const input = await body(request, createMapSchema);
  if (input instanceof NextResponse) return input;
  try {
    const map = await createMap(scope, { carrierId: input.carrier_id, productId: input.carrier_product_id ?? null, origin: input.origin });
    return NextResponse.json({ map }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

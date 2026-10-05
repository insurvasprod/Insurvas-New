import { NextResponse } from "next/server";

import { body, failure } from "@/lib/applications/http";
import { NO_STORE, tenantScope } from "@/lib/extension/http";
import { carrierOptions, createMap, listMaps } from "@/lib/extension/maps";
import { createMapSchema } from "@/lib/extension/schemas";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.13 · Settings › Sales › Carrier field maps. GET: the agency's maps and the platform's (read
 * only), plus the carriers a new map can be for. POST: a new draft (owner).
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("carrier_extension", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const scope = tenantScope(auth, request);
    const [maps, carriers] = await Promise.all([listMaps(scope), carrierOptions(scope)]);
    return NextResponse.json({ maps, carriers, canEdit: auth.context.role === "owner" }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("carrier_extension", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, createMapSchema);
  if (input instanceof NextResponse) return input;
  try {
    const map = await createMap(tenantScope(auth, request), { carrierId: input.carrier_id, productId: input.carrier_product_id ?? null, origin: input.origin });
    return NextResponse.json({ map }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

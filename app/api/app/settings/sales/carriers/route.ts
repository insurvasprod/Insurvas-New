import { NextResponse } from "next/server";

import { actorOf, body, failure } from "@/lib/applications/http";
import { addCarrierSchema } from "@/lib/salesSettings/carrierSchemas";
import { addCarrier, getCarriersView } from "@/lib/salesSettings/carriers";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LA-3.6 / 3.17 / 3.22 · Settings › Sales › Carriers and products. GET: the agency's carriers with
 * their products, own facts, appointment, field set, field map and portal account (there is no
 * password to send). POST: put a platform carrier on the agency's list (owners).
 */
export async function GET() {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const payload = await getCarriersView(auth.context.tenantId);
    return NextResponse.json({ ...payload, canEdit: auth.context.role === "owner" }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, addCarrierSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await addCarrier(actorOf(auth, request), input), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

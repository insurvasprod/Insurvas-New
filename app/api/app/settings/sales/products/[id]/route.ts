import { NextResponse } from "next/server";

import { actorOf, body, failure, isUuid } from "@/lib/applications/http";
import { updateProductSchema } from "@/lib/salesSettings/carrierSchemas";
import { updateProduct } from "@/lib/salesSettings/carriers";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-3.6 / 3.25 · change one of the agency's products. A platform product is refused (copy it first). Owners only. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That product could not be found." }, { status: 404 });
  const input = await body(request, updateProductSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ product: await updateProduct(actorOf(auth, request), id, input) });
  } catch (error) {
    return failure(error);
  }
}

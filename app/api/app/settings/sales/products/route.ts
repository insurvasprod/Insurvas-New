import { NextResponse } from "next/server";

import { actorOf, body, failure } from "@/lib/applications/http";
import { createProductSchema } from "@/lib/salesSettings/carrierSchemas";
import { createProduct } from "@/lib/salesSettings/carriers";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-3.6 / 3.25 · add one of the agency's own products to a carrier. Owners only. */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, createProductSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ product: await createProduct(actorOf(auth, request), input) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

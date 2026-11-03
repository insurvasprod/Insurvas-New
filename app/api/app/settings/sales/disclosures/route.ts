import { NextResponse } from "next/server";

import { actorOf, body, failure } from "@/lib/applications/http";
import { createDisclosure, disclosureInputSchema, listDisclosures } from "@/lib/salesSettings/disclosures";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LA-3.10 · Settings › Sales › Disclosures. GET: the library — the platform's published rows and every
 * version of the agency's own, with their rules (owners and producers). POST: a new draft (owners).
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await listDisclosures(actorOf(auth, request)), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, disclosureInputSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ item: await createDisclosure(actorOf(auth, request), input) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { copyDisclosure } from "@/lib/salesSettings/disclosures";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-3.10 / 3.17 · "Copy to my agency": a platform disclosure becomes the agency's own draft (owners). The original is untouched. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That disclosure could not be found." }, { status: 404 });
  try {
    return NextResponse.json({ item: await copyDisclosure(actorOf(auth, request), id) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

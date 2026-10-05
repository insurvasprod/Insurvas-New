import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { publishDisclosure } from "@/lib/salesSettings/disclosures";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-3.10 · publish a draft (owners). The agency's previous published version of the code is retired, never changed. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That disclosure could not be found." }, { status: 404 });
  try {
    return NextResponse.json({ item: await publishDisclosure(actorOf(auth, request), id) });
  } catch (error) {
    return failure(error);
  }
}

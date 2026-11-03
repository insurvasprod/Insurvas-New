import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { markPortalVerified } from "@/lib/salesSettings/portals";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-3.22 · "Mark verified": someone signed in today and it still works. Owners only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That portal account could not be found." }, { status: 404 });
  try {
    return NextResponse.json({ portal: await markPortalVerified(actorOf(auth, request), id) });
  } catch (error) {
    return failure(error);
  }
}

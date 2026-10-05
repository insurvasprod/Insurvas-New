import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { openNextAttempt } from "@/lib/applications/mutations";

/**
 * LA-3.16 · take a declined case to another carrier. The health interview, address, beneficiaries
 * and payment carry forward; the quote, disclosures, QA verdict and copy ticks do not. The declined
 * attempt is untouched.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That application could not be found." }, { status: 404 });
  try {
    return NextResponse.json(await openNextAttempt(actor, id), { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { retireSalesTemplate } from "@/lib/salesSettings/templates";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.1 / 3.4 / 3.7 · retire a published version: new interviews and quotes stop loading it; the
 * ones already taken keep pointing at it. Owners only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That template could not be found." }, { status: 404 });
  try {
    return NextResponse.json({ template: await retireSalesTemplate(actorOf(auth, request), id) });
  } catch (error) {
    return failure(error);
  }
}

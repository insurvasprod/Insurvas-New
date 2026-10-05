import { NextResponse } from "next/server";

import { actorOf, failure, isUuid } from "@/lib/applications/http";
import { copyProduct } from "@/lib/salesSettings/carriers";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/** LA-3.17 · "Copy to my agency" for a platform product; the platform row is untouched. Owners only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That product could not be found." }, { status: 404 });
  try {
    return NextResponse.json({ product: await copyProduct(actorOf(auth, request), id) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

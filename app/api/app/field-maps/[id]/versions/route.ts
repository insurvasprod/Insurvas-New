import { NextResponse } from "next/server";

import { failure, isUuid } from "@/lib/applications/http";
import { tenantScope } from "@/lib/extension/http";
import { newVersion } from "@/lib/extension/maps";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.13 · version N + 1 as a draft from a published map (owner). From a platform map it becomes
 * the agency's own copy. Sensitive entries must be verified again.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("carrier_extension", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That field map could not be found." }, { status: 404 });
  try {
    return NextResponse.json({ map: await newVersion(tenantScope(auth, request), id) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

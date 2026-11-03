import { NextResponse } from "next/server";

import { failure, isUuid } from "@/lib/applications/http";
import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { adminScopeFor } from "@/lib/extension/http";
import { newVersion } from "@/lib/extension/maps";

/** LA-3.13 · version N + 1 of a platform map, as a draft. Sensitive entries must be verified again. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = adminScopeFor(await resolveAdminContext(), request);
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That field map could not be found." }, { status: 404 });
  try {
    return NextResponse.json({ map: await newVersion(scope, id) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}

import { NextResponse } from "next/server";

import { body, failure, isUuid } from "@/lib/applications/http";
import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { adminScopeFor, NO_STORE } from "@/lib/extension/http";
import { getMap, saveMap } from "@/lib/extension/maps";
import { saveMapSchema } from "@/lib/extension/schemas";

const notFound = () => NextResponse.json({ error: "That field map could not be found." }, { status: 404 });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = adminScopeFor(await resolveAdminContext(), request);
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  try {
    return NextResponse.json({ map: await getMap(scope, id) }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

/** LA-3.13 · save a platform draft's pages and fields. Verifying needs a staff approver column (see maps.ts). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = adminScopeFor(await resolveAdminContext(), request);
  if (scope instanceof NextResponse) return scope;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const input = await body(request, saveMapSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ map: await saveMap(scope, id, input) });
  } catch (error) {
    return failure(error);
  }
}

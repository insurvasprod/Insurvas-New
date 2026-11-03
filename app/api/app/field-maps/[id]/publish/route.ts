import { NextResponse } from "next/server";

import { failure, isUuid } from "@/lib/applications/http";
import { tenantScope } from "@/lib/extension/http";
import { publishMap } from "@/lib/extension/maps";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.13 · publish (owner). The database's publish guard refuses while an SSN, routing, account or
 * card entry is unverified, and its message is returned as it is. The version this replaces retires.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("carrier_extension", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "That field map could not be found." }, { status: 404 });
  try {
    return NextResponse.json({ map: await publishMap(tenantScope(auth, request), id) });
  } catch (error) {
    return failure(error);
  }
}

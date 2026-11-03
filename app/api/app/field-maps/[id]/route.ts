import { NextResponse } from "next/server";

import { body, failure, isUuid } from "@/lib/applications/http";
import { NO_STORE, tenantScope } from "@/lib/extension/http";
import { getMap, saveMap } from "@/lib/extension/maps";
import { saveMapSchema } from "@/lib/extension/schemas";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const notFound = () => NextResponse.json({ error: "That field map could not be found." }, { status: 404 });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("carrier_extension", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  try {
    return NextResponse.json({ map: await getMap(tenantScope(auth, request), id) }, { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

/**
 * LA-3.13 · save a draft's pages and fields, including which ones a person has verified. Only a
 * draft or in-review map of the agency's own; a published map is frozen (start a new version).
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("carrier_extension", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!isUuid(id)) return notFound();
  const input = await body(request, saveMapSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json({ map: await saveMap(tenantScope(auth, request), id, input) });
  } catch (error) {
    return failure(error);
  }
}

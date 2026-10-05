import { NextResponse } from "next/server";

import { actorOf, body, failure } from "@/lib/applications/http";
import { getStageMap, saveStageMap, stageMapSchema } from "@/lib/salesSettings/stageMap";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * LA-3.23 · Settings › Sales › Pipeline sync. GET: the tenant's pipelines and stages and the current
 * map (owners and producers). PUT: owners — `{ map: { sync_key: stage_id | null } }`; null unmaps
 * ("Doesn't move the card"). Audited old → new.
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await getStageMap(actorOf(auth, request)), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const input = await body(request, stageMapSchema);
  if (input instanceof NextResponse) return input;
  try {
    return NextResponse.json(await saveStageMap(actorOf(auth, request), input.map));
  } catch (error) {
    return failure(error);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { vendorSample } from "@/lib/leadPost/boardStore";

/**
 * Round 8 · the field map's raw material: the vendor's last post's field names with an example each,
 * and the intake form's own questions their fields can fill. Owner only.
 */
const ROLES = ["owner"] as const;

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("lead_import", ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That is not a key id" }, { status: 400 });
  try {
    return NextResponse.json(await vendorSample(auth.context.tenantId, id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Their fields didn't load" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { postActivity } from "@/lib/leadPost/activity";

/**
 * Lead posting · recent posts and each vendor's rejections (owner pick A, 2026-10-30). Read-only.
 * The same gate as the keys it sits beside: owner only, on `lead_import`.
 */
const ROLES = ["owner"] as const;

export async function GET() {
  const auth = await requireFeatureRole("lead_import", ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await postActivity(auth.context.tenantId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load recent posts" }, { status: 500 });
  }
}

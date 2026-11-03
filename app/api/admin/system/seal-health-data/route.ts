import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { sealHealthBacklog } from "@/lib/applications/healthSeal";
import { CAN_CHANGE_MAINTENANCE } from "@/lib/system/adminFormat";

/**
 * Seals health answers written before 20261016420000 (one batch per call; call again until
 * `remaining` is 0). It must run on the production server: only its key can seal rows that its own
 * app will open again. Every row is opened and compared before its plain copy is cleared.
 * Super admin only, like maintenance: it touches every agency's records.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_CHANGE_MAINTENANCE);
  if (auth instanceof NextResponse) return auth;
  try {
    const result = await sealHealthBacklog();
    await audit({ actorId: auth.session.sub, action: "health_data.sealed", targetType: "system", targetId: "health_data", metadata: result, request });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not seal the health answers" }, { status: 409 });
  }
}

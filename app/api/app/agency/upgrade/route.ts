import { NextResponse, type NextRequest } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { needsUpgrade, runUpgrade, upgradePreview } from "@/lib/agency/upgradeStore";
import { isAgencyTenant } from "@/lib/agency/audience";
import { audit } from "@/lib/audit/log";

/**
 * AG-0.8 · finish turning a solo workspace into an agency, after the plan change. GET says whether it is still
 * needed and what it will attribute (the rehearsal counts); POST runs it — once, idempotently, in one
 * transaction.
 */
export async function GET() {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const agency = await isAgencyTenant(auth.context.tenantId);
  if (!agency) return NextResponse.json({ needed: false, reason: "not_agency_plan" });
  const needed = await needsUpgrade(auth.context.tenantId);
  return NextResponse.json({ needed, preview: needed ? await upgradePreview(auth.context.tenantId) : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    const counts = await runUpgrade(auth.context.tenantId, auth.context.userId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.upgraded", targetType: "tenant", targetId: auth.context.tenantId, metadata: { tenantId: auth.context.tenantId, counts }, request });
    return NextResponse.json({ ok: true, counts });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    const code = (error as { code?: string }).code;
    if (status === 500 && !code) console.error("[agency upgrade]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not finish the upgrade", code }, { status });
  }
}

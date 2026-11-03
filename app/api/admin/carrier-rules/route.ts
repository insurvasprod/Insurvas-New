import { NextResponse, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { carrierRulesAction, carrierRulesFailure, runCarrierRulesAction } from "@/lib/ingestion/carrierRulesHttp";
import { loadCarrierRules } from "@/lib/ingestion/carrierRulesStore";
import { layoutAdmin } from "@/lib/ingestion/layoutAdminHttp";

/** LA-4.17 · the platform's default carrier rules and settings, for staff (carrier-library access). */
export async function GET() {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  try {
    return NextResponse.json(await loadCarrierRules({ plane: "platform", adminId: scope.adminId }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return carrierRulesFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const body = carrierRulesAction.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the rule and try again." }, { status: 400 });
  try {
    const done = await runCarrierRulesAction({ plane: "platform", adminId: scope.adminId }, body.data);
    await audit({ actorType: "admin", actorId: scope.adminId, action: done.action, targetType: done.targetType, targetId: done.targetId, metadata: { plane: "platform", ...done.metadata }, request });
    return NextResponse.json({ ok: true, id: done.targetId }, { status: body.data.action === "add_rule" ? 201 : 200 });
  } catch (error) {
    return carrierRulesFailure(error);
  }
}

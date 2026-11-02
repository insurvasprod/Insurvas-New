import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { carrierRulesAction, carrierRulesFailure, runCarrierRulesAction } from "@/lib/ingestion/carrierRulesHttp";
import { CARRIER_RULES_PENDING_MESSAGE } from "@/lib/ingestion/carrierRulesStore";
import { loadCarrierRuleSides } from "@/lib/pipelineRules/carrierRuleSides";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Book of business › Setup › Carrier rules (owner decision 4, 2026-11-02): agencies may override a
 * carrier's rules. GET: each carrier's rules, Insurvas's value beside the agency's own. POST: the shared
 * carrier-rules actions on the agency plane — add a dated rule of the agency's own, clear it (back to
 * Insurvas's), verify it, or save the carrier's settings. Every read and write is scoped to the caller's
 * tenant; owner and bookkeeper; every change is audited. (The page removed on 2026-10-28 used the same
 * plane; this route brings it back for Setup.)
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const view = await loadCarrierRuleSides(auth.context.tenantId);
    return NextResponse.json({ ok: true, ...view, message: view.available ? null : CARRIER_RULES_PENDING_MESSAGE }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return carrierRulesFailure(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = carrierRulesAction.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Check the rule and try again." }, { status: 400 });
  try {
    const done = await runCarrierRulesAction({ plane: "agency", tenantId: auth.context.tenantId, userId: auth.context.userId }, body.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: done.action, targetType: done.targetType, targetId: done.targetId, metadata: { tenantId: auth.context.tenantId, ...done.metadata }, request });
    return NextResponse.json({ ok: true, id: done.targetId }, { status: body.data.action === "add_rule" || body.data.action === "clear_override" ? 201 : 200 });
  } catch (error) {
    return carrierRulesFailure(error);
  }
}

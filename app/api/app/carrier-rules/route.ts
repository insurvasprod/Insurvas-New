import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { carrierRulesAction, carrierRulesFailure, runCarrierRulesAction } from "@/lib/ingestion/carrierRulesHttp";
import { CARRIER_RULES_PENDING_MESSAGE, loadCarrierRules } from "@/lib/ingestion/carrierRulesStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-4.17 (Notion sprint) · this agency's carrier rules and settings: each carrier's rules in force
 * (its own over the platform's), what is missing and how many in-force policies that affects, and
 * the carrier's other settings. POST adds a rule from a date, clears an override, verifies a rule or
 * saves settings. Owner and bookkeeper; every change is a write and is audited.
 */
const roles = ["owner", "bookkeeper"] as const;

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  try {
    const view = await loadCarrierRules({ plane: "agency", tenantId: auth.context.tenantId, userId: auth.context.userId });
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

import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { SchemaGapError } from "@/lib/appointments/schemaGap";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_CALLING_RULES } from "@/lib/callingWindow/permissions";
import { CallingRuleError, getCallingRulesBoard, publishStateRule } from "@/lib/callingWindow/rulesAdmin";
import { effectiveDateProblem, publishRuleSchema } from "@/lib/callingWindow/rulesModel";

/**
 * State calling rules, for super admins.
 *
 * GET  the board: every state, every version of its rule, the holiday calendar and the rules feed.
 * POST publish a state rule from an effective date. The rule before it closes on that date.
 */
export async function GET() {
  const auth = await requireAdminRole(CAN_MANAGE_CALLING_RULES);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await getCallingRulesBoard(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the calling rules" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_CALLING_RULES);
  if (auth instanceof NextResponse) return auth;
  const parsed = publishRuleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid rule" }, { status: 400 });
  // Today in UTC. The database checks the same thing against its own date.
  const backdated = effectiveDateProblem(parsed.data.effectiveFrom, new Date().toISOString().slice(0, 10));
  if (backdated) return NextResponse.json({ error: backdated }, { status: 400 });
  try {
    const rule = await publishStateRule(parsed.data, auth.session.sub);
    await audit({
      actorId: auth.session.sub,
      action: "calling_rule.published",
      targetType: "calling_window_state_rule",
      targetId: rule.id,
      metadata: {
        state: rule.state,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        hours: `${rule.startLocal}-${rule.endLocal}`,
        allowedWeekdays: rule.allowedWeekdays,
        sundayHours: rule.sundayStartLocal ? `${rule.sundayStartLocal}-${rule.sundayEndLocal}` : null,
        blockHolidays: rule.blockHolidays,
        source: rule.source,
      },
      request,
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    if (error instanceof SchemaGapError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    const status = error instanceof CallingRuleError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not publish the rule" }, { status });
  }
}

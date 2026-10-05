import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { SchemaGapError } from "@/lib/appointments/schemaGap";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_CALLING_RULES } from "@/lib/callingWindow/permissions";
import { CallingRuleError, withdrawStateRule } from "@/lib/callingWindow/rulesAdmin";

/** DELETE · withdraw a state rule that has not taken effect. A rule in force is refused (400). */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_CALLING_RULES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That is not a rule id" }, { status: 400 });
  try {
    const rule = await withdrawStateRule(id);
    await audit({
      actorId: auth.session.sub,
      action: "calling_rule.withdrawn",
      targetType: "calling_window_state_rule",
      targetId: rule.id,
      metadata: { state: rule.state, effectiveFrom: rule.effectiveFrom, hours: `${rule.startLocal}-${rule.endLocal}`, source: rule.source },
      request,
    });
    return NextResponse.json({ rule });
  } catch (error) {
    if (error instanceof SchemaGapError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    const status = error instanceof CallingRuleError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not withdraw the rule" }, { status });
  }
}

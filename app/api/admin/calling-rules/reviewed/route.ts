import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { SchemaGapError } from "@/lib/appointments/schemaGap";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_CALLING_RULES } from "@/lib/callingWindow/permissions";
import { CallingRuleError, markRulesReviewed } from "@/lib/callingWindow/rulesAdmin";

/**
 * POST · the reviewer confirms the state rules as they stand. Stamps the rules feed: the dial check
 * refuses every call once that stamp is older than its limit (400 days), so a confirmed review is
 * what keeps an unchanged rule set trusted.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_CALLING_RULES);
  if (auth instanceof NextResponse) return auth;
  try {
    const at = await markRulesReviewed(auth.session.sub);
    await audit({
      actorId: auth.session.sub,
      action: "calling_rules.reviewed",
      targetType: "calling_window_rules_feed",
      targetId: "calling_window_rules_feed",
      metadata: { refreshedAt: at },
      request,
    });
    return NextResponse.json({ refreshedAt: at });
  } catch (error) {
    if (error instanceof SchemaGapError) return NextResponse.json({ error: error.message, code: "schema_pending" }, { status: 503 });
    const status = error instanceof CallingRuleError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not record the review" }, { status });
  }
}

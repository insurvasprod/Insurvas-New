import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-3.3 · what the Sales › AI assistant panel shows. The assistant itself is not built: choosing
 * the provider (and whether its terms allow prescription and health data) is decision 4, still open.
 * This says so plainly instead of offering a switch that does nothing, and states what WOULD be sent
 * — a property of the code's redaction rule, not a preference.
 */
export async function GET() {
  const auth = await requireFeatureRole("ai_assistant", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({
    available: false,
    enabled: false,
    provider: null,
    reason: "Not available yet — waiting on the choice of AI provider and its terms for health data.",
    sends: "Health answers and medications are sent. Social Security numbers, banking details and full contact records are never sent.",
  });
}

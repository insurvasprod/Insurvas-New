import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { actorOf, body, failure } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { startApplicationSchema } from "@/lib/applications/schemas";
import { startApplication } from "@/lib/applications/service";
import { ensureInterview } from "@/lib/applications/mutations";
import { OutboundApplicationError } from "@/lib/outboundApplication/service";

/**
 * LA-3 · the one doorway into an application. The dialer's "They are interested", an inbound
 * transfer's "Continue to underwriting" and a lead's "Start application" all POST here with the work
 * item, and all land on the same case — the LA-2.14 RPC opens or resumes it, unchanged, and this adds
 * the primary attempt with the lead's values prefilled.
 */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const actor = actorOf(auth, request);
  const input = await body(request, startApplicationSchema);
  if (input instanceof NextResponse) return input;
  try {
    const started = await startApplication({ tenantId: actor.tenantId, userId: actor.userId, workItemId: input.work_item_id, productLine: input.product_line ?? null });
    // The interview opens with the case: nothing else starts the primary insured's one, and the
    // workspace lands on it for a draft attempt.
    await ensureInterview(actor, started.applicationCaseId, "primary");
    await audit({ actorType: "tenant", actorId: actor.userId, action: "tenant.lead_stage_changed", targetType: "agent_lead", targetId: started.leadId, metadata: { operation: started.resumed ? "application_resumed" : "application_started", applicationCaseId: started.applicationCaseId, source: started.source }, request });
    return NextResponse.json({ caseId: started.applicationCaseId, leadId: started.leadId, resumed: started.resumed, href: `/app/applications/${started.applicationCaseId}` }, { status: started.resumed ? 200 : 201 });
  } catch (error) {
    if (error instanceof OutboundApplicationError) {
      const status = ["APPLICATION_OWNER_REQUIRED", "APPLICATION_WORK_ITEM_NOT_CLAIMED", "SETTER_MAY_NOT_TAKE_APPLICATIONS"].includes(error.code) ? 403 : ["WORK_ITEM_NOT_FOUND", "LEAD_NOT_FOUND"].includes(error.code) ? 404 : 503;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return failure(error);
  }
}

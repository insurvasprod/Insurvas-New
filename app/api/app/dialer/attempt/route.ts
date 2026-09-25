import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { DialerWorkflowError, DialGateError, startDialAttempt } from "@/lib/dialerScripts/service";
import { recordDialRefused } from "@/lib/leadWorkspace/refusals";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

// LA-2.12 audit. A setter's whole job is "work the outbound queue" and "record dispositions", and
// permissions.ts has granted them `dialer.use` since the role was added — but every route here
// admitted owners and producers only, so the role could not reach the surface it exists for, and the
// booking panel that lives inside this dialer was unreachable with it. Kept as a literal array
// because the money-route guard reads these lists statically; a test pins it to rolesWith("dialer.use").
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

// `inbound` marks a call the customer started, found through lead search rather than served by the
// queue. Decision 1: opening a lead through search is not a serve, so this attempt has no claimed
// work item and must not consume a cadence attempt.
const schema = z.object({ lead_id: z.string().uuid(), script_id: z.string().uuid().nullable().optional(), script_version: z.number().int().positive().nullable().optional(), disclosure_state: z.string().regex(/^[A-Za-z]{2}$/), disclosure_product_code: z.string().min(1).max(80), inbound: z.boolean().optional() }).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Lead, script and disclosure details are required" }, { status: 400 });
  try {
    const attempt = await startDialAttempt({ tenantId: auth.context.tenantId, agentId: auth.context.userId, leadId: parsed.data.lead_id, scriptId: parsed.data.script_id, scriptVersion: parsed.data.script_version ?? undefined, disclosureState: parsed.data.disclosure_state.toUpperCase(), disclosureProductCode: parsed.data.disclosure_product_code, inbound: parsed.data.inbound === true });
    return NextResponse.json({ attempt }, { status: 201 });
  } catch (error) {
    // A dial screening refused is never placed, so it leaves no attempt row; it is kept on the
    // lead's record instead, so its Attempts tab can say why nobody called.
    if (error instanceof DialGateError) await recordDialRefused({ tenantId: auth.context.tenantId, leadId: parsed.data.lead_id, actorId: auth.context.userId, reason: error.code, message: error.message, inbound: parsed.data.inbound === true });
    const status = error instanceof DialGateError || error instanceof DialerWorkflowError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start call attempt" }, { status });
  }
}

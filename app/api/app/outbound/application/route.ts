import { NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { OutboundApplicationError, startApplicationFromLead } from "@/lib/outboundApplication/service";
import { maskSensitivePanel } from "@/lib/verification/sensitive";
import { getVerificationPanel, updateVerificationField, VerificationError } from "@/lib/verification/service";

/**
 * LA-2.14 · "Interested — start application", for a lead the agent is working outbound.
 *
 * GET and PATCH call `getVerificationPanel` and `updateVerificationField` — the same two functions
 * `app/api/app/inbound/verification/route.ts` calls, with no outbound parameter and no second
 * implementation. The criterion is "the verification panel is the same component as inbound, with
 * no outbound-specific fork", and `lib/tenantAuth/outboundApplication.test.mjs` asserts it against
 * the route sources rather than trusting this comment.
 *
 * The routes differ in exactly one thing, and it is not a fork: the ENTITLEMENT. Inbound transfers
 * and outbound dialling are separate purchases, so gating the outbound door on `inbound_transfers`
 * would mean a tenant who bought the dialer could not use the dialer.
 *
 * A setter is excluded here and refused again inside the RPC. LA-2.12's role table says a setter
 * cannot "sell, quote, or submit an application"; the route states it and the database enforces it,
 * because a rule that lives only in TypeScript stops applying the moment anything else calls the API.
 *
 * Every panel leaves masked, as the inbound route's does: SSN, banking and policy numbers go out as
 * "•••• 4021" (lib/verification/sensitive.ts), and the full value only through ./reveal, which
 * writes an audit row first. Until 2026-09-24 this route returned them in full on all three verbs.
 */
const APPLICATION_ROLES = ["owner", "producer"] as const;

const startSchema = z.object({
  work_item_id: z.string().uuid(),
  product_line: z.string().trim().min(1).max(120).optional(),
}).strict();

const fieldSchema = z.object({
  work_item_id: z.string().uuid(),
  field_key: z.string().regex(/^[a-z][a-z0-9_]*$/, "Choose a valid field"),
  state: z.enum(["confirmed", "corrected", "outstanding"]),
  value: z.unknown().optional(),
}).strict();

function errorResponse(error: unknown) {
  if (error instanceof OutboundApplicationError) {
    if (["APPLICATION_OWNER_REQUIRED", "APPLICATION_WORK_ITEM_NOT_CLAIMED", "SETTER_MAY_NOT_TAKE_APPLICATIONS"].includes(error.code)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    }
    if (["WORK_ITEM_NOT_FOUND", "LEAD_NOT_FOUND"].includes(error.code)) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not start the application" }, { status: 503 });
  }
  if (error instanceof VerificationError) {
    if (error.code === "verification_owner_required") return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    if (["work_item_not_found", "lead_not_found"].includes(error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    if (["invalid_verification_value", "verification_field_not_found", "field_not_visible"].includes(error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    return NextResponse.json({ error: error.message || "Could not update verification" }, { status: 500 });
  }
  return NextResponse.json({ error: "Could not load the application" }, { status: 500 });
}

/** Start or resume. The same call does both; see the service for why that is not two paths. */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("outbound_dialing", APPLICATION_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;

  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid lead to start an application on" }, { status: 400 });

  try {
    const started = await startApplicationFromLead({
      tenantId: auth.context.tenantId,
      workItemId: parsed.data.work_item_id,
      userId: auth.context.userId,
      productLine: parsed.data.product_line ?? null,
    });

    // The panel comes back in the same response as the handoff, so the agent is looking at the
    // form rather than at a spinner followed by a second round trip. It is also the proof that the
    // door opened onto the real panel: if the session were not usable this would raise here.
    const panel = await getVerificationPanel(auth.context.tenantId, auth.context.userId, parsed.data.work_item_id);

    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.lead_stage_changed",
      targetType: "agent_lead",
      targetId: started.leadId,
      metadata: {
        operation: started.resumed ? "application_resumed" : "application_started",
        applicationCaseId: started.applicationCaseId,
        source: started.source,
      },
      request,
    });

    return NextResponse.json({ ...started, panel: maskSensitivePanel(panel) }, { status: started.resumed ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** The panel itself. Same function as inbound. */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("outbound_dialing", APPLICATION_ROLES);
  if (auth instanceof NextResponse) return auth;

  const workItemId = new URL(request.url).searchParams.get("work_item_id");
  const parsed = z.string().uuid().safeParse(workItemId);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid lead" }, { status: 400 });

  try {
    return NextResponse.json(maskSensitivePanel(await getVerificationPanel(auth.context.tenantId, auth.context.userId, parsed.data)));
  } catch (error) {
    return errorResponse(error);
  }
}

/** One field. Same function as inbound. */
export async function PATCH(request: Request) {
  const auth = await requireFeatureRole("outbound_dialing", APPLICATION_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;

  const parsed = fieldSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid field and verification state" }, { status: 400 });

  try {
    const updated = await updateVerificationField({
      tenantId: auth.context.tenantId,
      userId: auth.context.userId,
      workItemId: parsed.data.work_item_id,
      fieldKey: parsed.data.field_key,
      state: parsed.data.state,
      value: parsed.data.value,
      request,
    });
    return NextResponse.json({ ...updated, panel: maskSensitivePanel(updated.panel) });
  } catch (error) {
    return errorResponse(error);
  }
}

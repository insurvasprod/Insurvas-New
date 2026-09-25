import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getVerificationContext } from "@/lib/verification/context";
import { maskSensitivePanel } from "@/lib/verification/sensitive";
import { getVerificationPanel, updateVerificationField, VerificationError } from "@/lib/verification/service";

const workItemSchema = z.string().uuid();
const bodySchema = z.object({
  work_item_id: workItemSchema,
  field_key: z.string().regex(/^[a-z][a-z0-9_]*$/, "Choose a valid field"),
  state: z.enum(["confirmed", "corrected", "outstanding"]),
  value: z.unknown().optional(),
}).strict();

function errorResponse(error: unknown) {
  if (!(error instanceof VerificationError)) return NextResponse.json({ error: "Could not load verification" }, { status: 500 });
  if (["verification_owner_required"].includes(error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
  if (["work_item_not_found", "lead_not_found"].includes(error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
  if (["invalid_verification_value", "verification_field_not_found", "field_not_visible"].includes(error.code)) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
  return NextResponse.json({ error: error.message || "Could not update verification" }, { status: 500 });
}

type Panel = Awaited<ReturnType<typeof getVerificationPanel>>;

/**
 * The panel as this screen sends it: sensitive values masked to their last four (the full value
 * comes only from ./reveal, which audits), plus the claim, partner, call record and change history
 * around it. The context is best-effort: if it cannot be read the form still loads.
 */
async function screenPanel(panel: Panel, tenantId: string, userId: string, workItemId: string) {
  const context = await getVerificationContext({ tenantId, userId, workItemId, leadId: panel.lead.id, sessionId: panel.session.id }).catch(() => null);
  return { ...maskSensitivePanel(panel), context };
}

export async function GET(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const workItemId = new URL(request.url).searchParams.get("work_item_id");
  const parsed = workItemSchema.safeParse(workItemId);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid transfer" }, { status: 400 });
  try {
    const panel = await getVerificationPanel(auth.context.tenantId, auth.context.userId, parsed.data);
    return NextResponse.json(await screenPanel(panel, auth.context.tenantId, auth.context.userId, parsed.data));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
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
    return NextResponse.json({ ...updated, panel: await screenPanel(updated.panel, auth.context.tenantId, auth.context.userId, parsed.data.work_item_id) });
  } catch (error) { return errorResponse(error); }
}

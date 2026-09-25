import { NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { isSensitiveFieldKey } from "@/lib/verification/sensitive";
import { getVerificationPanel, VerificationError } from "@/lib/verification/service";

const bodySchema = z.object({
  work_item_id: z.string().uuid(),
  field_key: z.string().regex(/^[a-z][a-z0-9_]*$/, "Choose a valid field"),
}).strict();

/**
 * The full value of one masked verification field, for reading it back to the customer.
 *
 * The verification screen shows SSN, banking and policy numbers as "•••• 4021"
 * (lib/verification/sensitive.ts). This returns the unmasked value, and only after writing a
 * `tenant.verification_field_revealed` audit row: if the row cannot be written, the value is not
 * returned. Same roles as the verification screen, and the same ownership rule — the panel read
 * below refuses anyone but the agent who holds the transfer's open verification session.
 */
export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid field to reveal" }, { status: 400 });
  if (!isSensitiveFieldKey(parsed.data.field_key)) return NextResponse.json({ error: "That field is not masked." }, { status: 400 });

  try {
    const panel = await getVerificationPanel(auth.context.tenantId, auth.context.userId, parsed.data.work_item_id);
    const onForm = panel.sections.some((section) => section.fields.some((field) => field.field_key === parsed.data.field_key));
    if (!onForm) return NextResponse.json({ error: "That field is not on this application." }, { status: 404 });
    const value = panel.lead.values[parsed.data.field_key] ?? null;
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.verification_field_revealed",
      targetType: "agent_lead",
      targetId: panel.lead.id,
      metadata: { workItemId: parsed.data.work_item_id, sessionId: panel.session.id, fieldKey: parsed.data.field_key },
      request,
    });
    return NextResponse.json({ field_key: parsed.data.field_key, value });
  } catch (error) {
    if (error instanceof VerificationError) {
      const status = error.code === "verification_owner_required" ? 403 : ["work_item_not_found", "lead_not_found"].includes(error.code) ? 404 : 500;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json({ error: "Could not reveal this field. Nothing was shown." }, { status: 500 });
  }
}

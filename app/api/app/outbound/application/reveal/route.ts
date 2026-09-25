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
 * The full value of one masked field on an outbound application, for reading it back to the
 * customer.
 *
 * ../route.ts masks SSN, banking and policy numbers to "•••• 4021", exactly as the inbound route
 * does; this is the one way to the full value, and it writes the same
 * `tenant.verification_field_revealed` audit row as ../../inbound/verification/reveal first — if the
 * row cannot be written, the value is not returned. It exists so masking the outbound panel did not
 * leave an agency that bought the dialer without inbound transfers unable to read a value back.
 * Same gate and roles as the outbound application (a setter may not take applications), and the
 * same ownership rule: the panel read refuses anyone but the agent holding the open session.
 */
const APPLICATION_ROLES = ["owner", "producer"] as const;

export async function POST(request: Request) {
  const auth = await requireFeatureRole("outbound_dialing", APPLICATION_ROLES);
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
      metadata: { workItemId: parsed.data.work_item_id, sessionId: panel.session.id, fieldKey: parsed.data.field_key, path: "outbound" },
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

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { limitEmailDraft, sendLimitEmail } from "@/lib/creditsLimits/ownerEmail";

// The Credits & limits gate, as every route beside this one: super_admin and platform_config.
const roles = ["super_admin", "platform_config"] as const;
const schema = z.object({
  tenant_id: z.string().uuid(),
  /** A meter key, or "seats". */
  meter: z.string().regex(/^[a-z0-9_]{1,64}$/),
});

/**
 * "Email the owner" from a usage row's sheet (admin round 1, billing-r2 screen 10). GET previews the exact email
 * (to, subject, body, whether delivery is on here); POST sends it, at most once per customer, meter and day, and
 * writes one audit row. The row's numbers are read again on the server, never taken from the browser.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(roles);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(request.url);
  const parsed = schema.safeParse({ tenant_id: url.searchParams.get("tenant_id"), meter: url.searchParams.get("meter") });
  if (!parsed.success) return NextResponse.json({ error: "Choose a customer and a meter" }, { status: 400 });
  try {
    const draft = await limitEmailDraft(parsed.data.tenant_id, parsed.data.meter);
    if (!draft.ok) return NextResponse.json({ error: draft.reason }, { status: draft.status });
    return NextResponse.json({ to: draft.to, subject: draft.subject, text: draft.text, delivery: draft.delivery });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare the email" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(roles);
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a customer and a meter" }, { status: 400 });
  const { tenant_id, meter } = parsed.data;

  let result: Awaited<ReturnType<typeof sendLimitEmail>>;
  try {
    result = await sendLimitEmail(tenant_id, meter);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send the email" }, { status: 500 });
  }
  const { draft, delivery, alreadySent } = result;
  if (!draft.ok) return NextResponse.json({ error: draft.reason }, { status: draft.status });
  if (alreadySent) return NextResponse.json({ error: "The owner was already emailed about this limit today." }, { status: 409 });

  // The attempt is recorded whatever the transport answered: email_log has the delivery, this has who asked.
  try {
    await audit({
      actorId: auth.session.sub,
      action: "usage_limit.owner_emailed",
      targetType: "tenant",
      targetId: tenant_id,
      metadata: { meter, used: draft.entry.used, limit: draft.entry.limit, to: draft.to, delivered: delivery?.delivered ?? false, reason: delivery && !delivery.delivered ? delivery.reason : null },
      request,
    });
  } catch {
    return NextResponse.json({ error: "The email was handed to the transport, but the audit entry could not be written.", sent: delivery?.delivered ?? false }, { status: 500 });
  }

  if (!delivery?.delivered) {
    const why = delivery?.reason === "email_delivery_disabled" ? "Email delivery is off here, so it was recorded but not sent." : delivery?.reason === "reserved_test_recipient" ? "The owner's address is a test address, so it was recorded but not sent." : "The mail server did not accept it. It was recorded as failed; try again later.";
    return NextResponse.json({ ok: false, sent: false, message: why }, { status: 200 });
  }
  return NextResponse.json({ ok: true, sent: true, message: `Emailed ${draft.to}` });
}

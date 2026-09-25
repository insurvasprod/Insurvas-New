import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { SchemaPendingError } from "@/lib/carriers/schemaGap";
import { supportContactInputSchema } from "@/lib/partnerSupport/contact";
import { getSupportContact, saveSupportContact } from "@/lib/partnerSupport/service";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";

/**
 * The support email and phone this agency's partners see in partner portal › Messages › Details.
 * Owners only. Always the caller's own tenant, from the verified session.
 */
export async function GET() {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ contact: await getSupportContact(auth.context.tenantId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[partner-support-contact] failed to load", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load the support contact" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireTenant(["owner"]);
  if (auth instanceof NextResponse) return auth;
  const parsed = supportContactInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter a valid support contact" }, { status: 400 });
  try {
    const contact = await saveSupportContact(auth.context.tenantId, parsed.data);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.partner_support_contact_saved",
      targetType: "tenant",
      targetId: auth.context.tenantId,
      metadata: { emailSet: contact.email !== null, phoneSet: contact.phone !== null },
      request,
    });
    return NextResponse.json({ contact });
  } catch (error) {
    if (error instanceof SchemaPendingError) return NextResponse.json({ error: error.message }, { status: 503 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the support contact" }, { status: 400 });
  }
}

import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_STATE_DISCLOSURES } from "@/lib/stateDisclosures/permissions";
import { updateStateDisclosureSchema } from "@/lib/stateDisclosures/schemas";
import { deleteStateDisclosure, updateStateDisclosure } from "@/lib/stateDisclosures/service";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_STATE_DISCLOSURES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const parsed = updateStateDisclosureSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid change" }, { status: 400 });
  try {
    const disclosure = await updateStateDisclosure(id, parsed.data);
    await audit({
      actorId: auth.session.sub,
      action: "state_disclosure.updated",
      targetType: "state_disclosure",
      targetId: disclosure.id,
      metadata: { state: disclosure.state, productCode: disclosure.product_code, effectiveFrom: disclosure.effective_from, textChanged: parsed.data.required_text !== undefined },
      request,
    });
    return NextResponse.json({ disclosure });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update the disclosure" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_STATE_DISCLOSURES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  try {
    const disclosure = await deleteStateDisclosure(id);
    await audit({
      actorId: auth.session.sub,
      action: "state_disclosure.withdrawn",
      targetType: "state_disclosure",
      targetId: disclosure.id,
      // Withdrawing a live row re-blocks dialing for that state and product, so the audit records
      // whether it was the one in force rather than an old version being tidied away.
      metadata: { state: disclosure.state, productCode: disclosure.product_code, effectiveFrom: disclosure.effective_from, wasLive: disclosure.live },
      request,
    });
    return NextResponse.json({ disclosure });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not withdraw the disclosure" }, { status: 400 });
  }
}

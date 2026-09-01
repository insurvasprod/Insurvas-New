import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { partnerActionSchema } from "@/lib/partners/schemas";
import { addPartnerTerm, transitionPartner, updatePartner } from "@/lib/partners/service";

const PARTNER_ROLES = ["owner", "bookkeeper"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", PARTNER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = partnerActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid partner changes" }, { status: 400 });
  try {
    if (parsed.data.action === "update") {
      const partner = await updatePartner(auth.context.tenantId, id, parsed.data);
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_updated", targetType: "partner", targetId: id, metadata: { name: partner.name, partnerType: partner.partner_type }, request });
      return NextResponse.json({ partner });
    }
    if (parsed.data.action === "add_term") {
      const term = await addPartnerTerm(auth.context.tenantId, id, auth.context.userId, parsed.data);
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_term_added", targetType: "partner_term", targetId: term.id, reason: `Effective ${term.effective_from}`, metadata: { partnerId: id, payoutModel: term.payout_model, rateCents: term.rate_cents, ratePctBp: term.rate_pct_bp, effectiveFrom: term.effective_from }, request });
      return NextResponse.json({ term }, { status: 201 });
    }
    const partner = await transitionPartner(auth.context.tenantId, id, parsed.data.next_status, parsed.data.confirmation);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_lifecycle_changed", targetType: "partner", targetId: id, reason: parsed.data.reason, metadata: { from: "current", to: partner.status, revokedPartnerUsers: partner.status === "offboarded" }, request });
    return NextResponse.json({ partner });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update partner";
    const status = message.includes("already_offboarded") || message.includes("invalid_partner_transition") ? 409 : 400;
    return NextResponse.json({ error: message.includes("offboard_confirmation_required") ? "Type OFFBOARD to confirm permanent portal revocation." : message, code: message.includes("offboard_confirmation_required") ? "offboard_confirmation_required" : "partner_update_failed" }, { status });
  }
}

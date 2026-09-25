import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { partnerActionSchema } from "@/lib/partners/schemas";
import { addPartnerTerm, transitionPartner, updatePartner } from "@/lib/partners/service";
import type { PartnerType } from "@/lib/partners/constants";
import { friendlyPartnerDbError } from "@/lib/partners/dbErrors";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { parsePartnerLimitError, partnerLimitBody, type PartnerLimitAction } from "@/lib/partnerLimits/copy";
import { PARTNER_TYPE_CAP_KEY, atLimitUserRefusalRetry, atPartnerCap, draftCompensatedLimit } from "@/lib/partnerLimits/rules";
import { countActivePartners } from "@/lib/partnerLimits/usage";

const PARTNER_ROLES = ["owner", "bookkeeper"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", PARTNER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = partnerActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid partner changes" }, { status: 400 });
  const tenantId = auth.context.tenantId;
  const limits = auth.entitlement.limits;
  // What the refusal says the caller was doing: a draft is activated, a paused partner is resumed.
  let limitAction: PartnerLimitAction = "activate";
  try {
    if (parsed.data.action === "update") {
      const input = parsed.data;
      limitAction = "change_type";
      // A type change needs room among the ACTIVE partners already in the new type (LA-1.19).
      const { data: current } = await getSupabaseServiceClient().from("partners").select("partner_type").eq("tenant_id", tenantId).eq("id", id).maybeSingle<{ partner_type: PartnerType }>();
      const capKey = PARTNER_TYPE_CAP_KEY[input.partner_type];
      const cap = limits[capKey];
      const retyped = current != null && current.partner_type !== input.partner_type && cap != null;
      const activeCount = retyped ? await countActivePartners(tenantId, input.partner_type, id) : 0;
      if (retyped && atPartnerCap(activeCount, cap)) return NextResponse.json(partnerLimitBody(capKey, activeCount, cap as number, "change_type"), { status: 403 });
      let partner;
      try {
        partner = await updatePartner(tenantId, id, input, limits);
      } catch (error) {
        const refused = parsePartnerLimitError(error instanceof Error ? error.message : "");
        const raised = retyped && refused?.key === capKey ? draftCompensatedLimit(refused.used, activeCount, cap as number) : null;
        if (raised == null) throw error;
        partner = await updatePartner(tenantId, id, input, { ...limits, [capKey]: raised });
      }
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_updated", targetType: "partner", targetId: id, metadata: { name: partner.name, partnerType: partner.partner_type }, request });
      return NextResponse.json({ partner });
    }
    if (parsed.data.action === "add_term") {
      const term = await addPartnerTerm(tenantId, id, auth.context.userId, parsed.data);
      await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_term_added", targetType: "partner_term", targetId: term.id, reason: `Effective ${term.effective_from}`, metadata: { partnerId: id, payoutModel: term.payout_model, rateCents: term.rate_cents, ratePctBp: term.rate_pct_bp, effectiveFrom: term.effective_from }, request });
      return NextResponse.json({ term }, { status: 201 });
    }
    // Read the status being left so the audit row says "from active to paused", not "from current".
    const { data: previous } = await getSupabaseServiceClient().from("partners").select("status").eq("tenant_id", tenantId).eq("id", id).maybeSingle<{ status: string }>();
    const transition = parsed.data;
    limitAction = previous?.status === "paused" ? "resume" : "activate";
    let partner;
    try {
      partner = await transitionPartner(tenantId, id, transition.next_status, transition.confirmation, limits);
    } catch (error) {
      // Before 20260925709950 the partner-user check refused at exactly the limit. Reaching it is allowed.
      const refused = parsePartnerLimitError(error instanceof Error ? error.message : "");
      const raised = refused?.key === "max_partner_users" && limits.max_partner_users != null ? atLimitUserRefusalRetry(refused.used, limits.max_partner_users) : null;
      if (raised == null) throw error;
      partner = await transitionPartner(tenantId, id, transition.next_status, transition.confirmation, { ...limits, max_partner_users: raised });
    }
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_lifecycle_changed", targetType: "partner", targetId: id, reason: transition.reason, metadata: { from: previous?.status ?? null, to: partner.status, revokedPartnerUsers: partner.status === "offboarded" }, request });
    return NextResponse.json({ partner });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update partner";
    // partner_limit_reached (a partner slot) and partner_user_limit_reached (the partner's users
    // would take the plan over max_partner_users) are both a 403 that names the limit in words.
    const limit = parsePartnerLimitError(message);
    if (limit) return NextResponse.json(partnerLimitBody(limit.key, limit.used, limit.limit, limitAction), { status: 403 });
    const status = message.includes("already_offboarded") || message.includes("invalid_partner_transition") ? 409 : 400;
    return NextResponse.json({ error: message.includes("offboard_confirmation_required") ? "Type OFFBOARD to confirm permanent portal revocation." : friendlyPartnerDbError(message) ?? message, code: message.includes("offboard_confirmation_required") ? "offboard_confirmation_required" : "partner_update_failed" }, { status });
  }
}

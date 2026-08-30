import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { fetchAllSwitches, setSwitch } from "@/lib/features/killSwitch";
import { SWITCH_STATES, switchRefusalReason, OFF_MESSAGE_MAX } from "@/lib/features/killSwitchRules";

// super_admin only, and narrower than the feature catalog beside it on the same screen.
//
// platform_config maintains the catalog — naming and describing what CAN be sold. Switching a
// feature off is an incident action that takes something away from every paying customer at once.
// Different question, different answer; do not collapse them because they share a page.
const CAN_TOGGLE = ["super_admin"] as const;

const bodySchema = z.object({
  feature_key: z.string().trim().min(1),
  state: z.enum(SWITCH_STATES),
  beta_tenant_ids: z.array(z.string().uuid()).max(500).default([]),
  off_message: z.string().trim().max(OFF_MESSAGE_MAX).nullable().default(null),
  // Required, and it is the "why" half of the ticket's audit criterion. A switch flipped during an
  // incident with no stated reason is the one nobody can explain a week later.
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
});

export async function GET() {
  const auth = await requireAdminRole(CAN_TOGGLE);
  if (auth instanceof NextResponse) return auth;

  const switches = await fetchAllSwitches();
  return NextResponse.json({ switches: [...switches.values()] });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminRole(CAN_TOGGLE);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { feature_key, state, beta_tenant_ids, off_message, reason } = parsed.data;

  // The same validator the form uses, so the screen can never accept something this refuses.
  const refusal = switchRefusalReason({ state, betaTenantIds: beta_tenant_ids, offMessage: off_message });
  if (refusal) return NextResponse.json({ error: refusal }, { status: 400 });

  try {
    const change = await setSwitch(
      { featureKey: feature_key, state, betaTenantIds: beta_tenant_ids, offMessage: off_message },
      auth.session.sub,
    );

    await audit({
      actorId: auth.session.sub,
      action: "feature.switch_changed",
      targetType: "feature",
      targetId: feature_key,
      reason,
      metadata: {
        changes: {
          state: { from: change.from?.state ?? "on", to: change.to.state },
          betaTenants: { from: change.from?.beta_tenant_ids?.length ?? 0, to: change.to.beta_tenant_ids.length },
        },
      },
      request,
    });

    return NextResponse.json({ ok: true, featureSwitch: change.to });
  } catch (error) {
    // 23503 = the feature_key does not exist in the catalog. Worth naming, because the most likely
    // cause is a typo or a feature that was renamed rather than archived.
    const message = error instanceof Error && error.message.includes("23503")
      ? `No feature called "${feature_key}" exists in the catalog.`
      : "Could not save this switch";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

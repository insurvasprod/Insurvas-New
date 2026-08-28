import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_MANAGE_SUBSCRIPTIONS } from "@/lib/subscriptions/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";
import { rebuildEntitlement } from "@/lib/entitlements/rebuild";

const attachSchema = z.object({
  addon_id: z.string().uuid(),
  /** Attach even though the plan doesn't offer it — recorded on the row and in the audit log. */
  override_availability: z.boolean().default(false),
});

const detachSchema = z.object({ subscription_addon_id: z.string().uuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_SUBSCRIPTIONS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, tenant_id")
    .eq("id", id)
    .maybeSingle<{ id: string; tenant_id: string }>();

  if (!subscription) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  const { data: attachmentId, error } = await supabase.rpc("admin_attach_addon", {
    p_subscription_id: id,
    p_addon_id: parsed.data.addon_id,
    p_override_availability: parsed.data.override_availability,
    p_attached_by: auth.session.sub,
  });

  if (error) {
    const cycleMismatch = /cycle_mismatch:(\w+):(\w+)/.exec(error.message ?? "");
    if (cycleMismatch) {
      const [, addonCycle, subCycle] = cycleMismatch;
      return NextResponse.json(
        { error: `This add-on bills ${addonCycle} but the subscription is ${subCycle}. They must match.` },
        { status: 400 },
      );
    }
    if (error.message?.includes("not_available_on_plan")) {
      return NextResponse.json(
        { error: "This plan doesn't offer that add-on. Attach it anyway to override." },
        { status: 409 },
      );
    }
    if (error.message?.includes("addon_inactive")) {
      return NextResponse.json({ error: "That add-on is no longer sold" }, { status: 409 });
    }
    // 23505: already attached and not detached.
    if (error.code === "23505") {
      return NextResponse.json({ error: "That add-on is already attached" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not attach the add-on" }, { status: 500 });
  }

  // Grants change immediately, so the entitlement must be rebuilt before responding.
  await rebuildEntitlement(subscription.tenant_id, "subscription.plan_changed");

  await audit({
    actorId: auth.session.sub,
    action: "subscription.addon_attached",
    targetType: "subscription",
    targetId: id,
    metadata: {
      tenantId: subscription.tenant_id,
      addonId: parsed.data.addon_id,
      availabilityOverridden: parsed.data.override_availability,
    },
    request,
  });

  return NextResponse.json({ attachmentId }, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_SUBSCRIPTIONS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = detachSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("id, tenant_id")
    .eq("id", id)
    .maybeSingle<{ id: string; tenant_id: string }>();

  if (!subscription) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  // Soft detach — the row survives so a past invoice can still explain what was charged.
  const { data: detached, error } = await supabase.rpc("admin_detach_addon", {
    p_subscription_addon_id: parsed.data.subscription_addon_id,
  });

  if (error) return NextResponse.json({ error: "Could not detach the add-on" }, { status: 500 });
  if (!detached) return NextResponse.json({ error: "That add-on isn't attached" }, { status: 404 });

  await rebuildEntitlement(subscription.tenant_id, "subscription.plan_changed");

  await audit({
    actorId: auth.session.sub,
    action: "subscription.addon_detached",
    targetType: "subscription",
    targetId: id,
    metadata: { tenantId: subscription.tenant_id, subscriptionAddonId: parsed.data.subscription_addon_id },
    request,
  });

  return NextResponse.json({ ok: true });
}

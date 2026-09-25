import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_PLANS } from "@/lib/plans/permissions";
import { updateAddonSchema } from "@/lib/addons/schemas";
import { addonMutationError, prepareAddonUpdate, upsertAddon, type AddonBefore } from "@/lib/addons/admin";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_PLANS);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = updateAddonSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });

  const { data: before } = await getSupabaseServiceClient()
    .from("addons")
    .select("id, code, price_cents, billing_cycle")
    .eq("id", id)
    .maybeSingle<AddonBefore>();
  if (!before) return NextResponse.json({ error: "Add-on not found" }, { status: 404 });

  // Price/cycle lock and older-plan-version availability, enforced before the RPC sees the input.
  const prepared = await prepareAddonUpdate(before, parsed.data);
  if (!prepared.ok) return NextResponse.json({ error: prepared.message }, { status: prepared.status });

  try {
    await upsertAddon(prepared.input, id);
    await audit({
      actorId: auth.session.sub,
      action: parsed.data.is_active ? "addon.updated" : "addon.archived",
      targetType: "addon",
      targetId: id,
      metadata: {
        code: before.code,
        isActive: parsed.data.is_active,
        // Money changes are named in the trail, not left to be inferred from a diff nobody kept.
        ...(before.price_cents !== parsed.data.price_cents || before.billing_cycle !== parsed.data.billing_cycle
          ? {
              priceCentsBefore: before.price_cents,
              priceCentsAfter: parsed.data.price_cents,
              billingCycleBefore: before.billing_cycle,
              billingCycleAfter: parsed.data.billing_cycle,
            }
          : {}),
      },
      request,
    });
    return NextResponse.json({ id });
  } catch (error) {
    const mapped = addonMutationError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

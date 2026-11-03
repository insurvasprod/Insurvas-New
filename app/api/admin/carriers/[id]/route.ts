import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole, type AdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { blockingUsage, CARRIER_COLUMNS, getPlatformCarrier, setCarrierActive } from "@/lib/carriers/adminService";
import type { CarrierRow } from "@/lib/carriers/constants";
import { updateCarrierSchema } from "@/lib/carriers/schemas";
import { blockingSentence, CARRIER_IN_USE_CODE, isInUse, OVERRIDE_REASON_MAX, OVERRIDE_REASON_MIN, type CarrierBlockingUsage } from "@/lib/carriers/usage";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const ROLES = ["super_admin", "platform_config"] as const;

type Params = { params: Promise<{ id: string }> };

function inUseResponse(carrier: CarrierRow, usage: CarrierBlockingUsage | null, session: AdminContext) {
  const canOverride = session.role === "super_admin";
  const sentence = usage ? blockingSentence(carrier.name, usage) : `Tenants still use ${carrier.name}.`;
  return NextResponse.json(
    {
      error: `${sentence} ${canOverride ? "Deactivating it needs an override with a reason." : "Only a super admin can deactivate a carrier tenants use."}`,
      code: CARRIER_IN_USE_CODE,
      usage,
      canOverride,
    },
    { status: 409 },
  );
}

/**
 * Deactivation, guarded (user decision, migration 20260924357000): refused with a 409 and the counts
 * while any tenant has an active contract or an open appointment with the carrier, unless a super
 * admin gives a reason. The trigger enforces the same rule for every other writer.
 */
async function deactivate(request: NextRequest, session: AdminContext, carrier: CarrierRow, overrideReason: string | undefined) {
  const usage = await blockingUsage(carrier.id);
  const inUse = isInUse(usage);
  if (inUse && !overrideReason) return inUseResponse(carrier, usage, session);
  if (inUse && session.role !== "super_admin") return inUseResponse(carrier, usage, session);

  const result = await setCarrierActive(carrier.id, false, inUse ? overrideReason! : null);
  if (!result.ok && result.reason === "not_found") return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
  // A contract or appointment arrived between the count and the write: the trigger caught it.
  if (!result.ok) return inUseResponse(carrier, result.usage, session);

  await audit({
    actorId: session.sub,
    action: inUse ? "carrier.deactivated_in_use" : "carrier.archived",
    targetType: "carrier",
    targetId: carrier.id,
    reason: inUse ? overrideReason : undefined,
    metadata: { code: carrier.code, name: carrier.name, usage },
    request,
  });
  return result.carrier;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAdminRole(ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = updateCarrierSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid carrier" }, { status: 400 });
  const { is_active: nextActive, override_reason: overrideReason, ...fields } = parsed.data;
  if (overrideReason && auth.session.role !== "super_admin") {
    return NextResponse.json({ error: "Only a super admin can override the deactivation guard" }, { status: 403 });
  }

  try {
    let carrier = await getPlatformCarrier(id);
    if (!carrier) return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
    const deactivating = nextActive === false && carrier.is_active;
    const reactivating = nextActive === true && !carrier.is_active;

    // The guard answers before anything is written, so a refused deactivation changes nothing else.
    if (deactivating) {
      const usage = await blockingUsage(carrier.id);
      if (isInUse(usage) && (!overrideReason || auth.session.role !== "super_admin")) return inUseResponse(carrier, usage, auth.session);
    }

    const changes: { name?: string; sort_order?: number } = {};
    if (fields.name !== undefined) changes.name = fields.name;
    if (fields.sort_order !== undefined) changes.sort_order = fields.sort_order;
    if (Object.keys(changes).length > 0) {
      const { data, error } = await getSupabaseServiceClient().from("carriers").update(changes).eq("id", id).is("organization_id", null).select(CARRIER_COLUMNS).maybeSingle();
      if (error) return NextResponse.json({ error: "Could not update carrier" }, { status: 500 });
      if (!data) return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
      carrier = data as CarrierRow;
      await audit({ actorId: auth.session.sub, action: "carrier.updated", targetType: "carrier", targetId: id, metadata: { changes }, request });
    }

    if (deactivating) {
      const outcome = await deactivate(request, auth.session, carrier, overrideReason);
      if (outcome instanceof NextResponse) return outcome;
      carrier = outcome;
    } else if (reactivating) {
      const result = await setCarrierActive(id, true, null);
      if (!result.ok) return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
      carrier = result.carrier;
      await audit({ actorId: auth.session.sub, action: "carrier.restored", targetType: "carrier", targetId: id, metadata: { code: carrier.code, name: carrier.name }, request });
    }

    return NextResponse.json({ carrier });
  } catch {
    return NextResponse.json({ error: "Could not update carrier" }, { status: 500 });
  }
}

/** Kept for existing callers: deactivates (never deletes), under the same guard. Body may carry override_reason. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireAdminRole(ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { override_reason?: unknown } | null;
  const overrideReason = typeof body?.override_reason === "string" && body.override_reason.trim().length >= OVERRIDE_REASON_MIN ? body.override_reason.trim().slice(0, OVERRIDE_REASON_MAX) : undefined;
  if (overrideReason && auth.session.role !== "super_admin") {
    return NextResponse.json({ error: "Only a super admin can override the deactivation guard" }, { status: 403 });
  }
  try {
    const carrier = await getPlatformCarrier(id);
    if (!carrier) return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
    if (!carrier.is_active) return NextResponse.json({ carrier, archived: true });
    const outcome = await deactivate(request, auth.session, carrier, overrideReason);
    if (outcome instanceof NextResponse) return outcome;
    return NextResponse.json({ carrier: outcome, archived: true });
  } catch {
    return NextResponse.json({ error: "Could not deactivate carrier" }, { status: 500 });
  }
}

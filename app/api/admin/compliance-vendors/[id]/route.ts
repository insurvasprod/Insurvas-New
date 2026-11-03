import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_COMPLIANCE_VENDORS } from "@/lib/compliance/permissions";
import { getComplianceVendorState, otherDncVendorsAfterRemoving, updateComplianceVendor } from "@/lib/compliance/service";
import { updateComplianceVendorSchema } from "@/lib/compliance/schemas";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_COMPLIANCE_VENDORS);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = updateComplianceVendorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid vendor" }, { status: 400 });

  const { confirm_dnc_block, ...input } = parsed.data;
  // Only a change that takes an ENABLED DNC vendor out of the DNC pool can block dialing: disabling
  // it, or retyping it away from dnc_scrub. (Disabling a litigator vendor used to trip this too.)
  const disables = Object.prototype.hasOwnProperty.call(input, "is_enabled") && input.is_enabled === false;
  const retypes = Boolean(input.vendor_type) && input.vendor_type !== "dnc_scrub";
  let current: Awaited<ReturnType<typeof getComplianceVendorState>> = null;
  if (disables || retypes) {
    try { current = await getComplianceVendorState(id); }
    catch { return NextResponse.json({ error: "Could not check DNC availability. Nothing was changed." }, { status: 503 }); }
  }
  const removesDncAvailability = current?.vendor_type === "dnc_scrub" && current.is_enabled && (disables || retypes);
  if (removesDncAvailability && confirm_dnc_block !== true) {
    // The server re-check is the authority. A browser confirmation alone cannot bypass this rule,
    // and two admins changing the last DNC source cannot accidentally make the intent invisible.
    // "Last" means the last one the gate counts as available (p-adm-compliance f3), so disabling the
    // one healthy vendor beside an unreachable one asks too.
    const others = await otherDncVendorsAfterRemoving(id).catch(() => null);
    if (others === null || others.available === 0) {
      const error = others && others.enabled > 0
        ? "This leaves no available DNC vendor: every other enabled one failed all of its calls in the last 24 hours. Dialing will be blocked platform-wide until a DNC vendor answers again."
        : "This disables the last enabled DNC vendor. Dialing will be blocked platform-wide until another DNC vendor is enabled.";
      return NextResponse.json({ requiresConfirmation: true, vendorName: current?.name ?? null, error }, { status: 409 });
    }
  }

  try {
    const vendor = await updateComplianceVendor(id, input);
    const changedCredentials = Object.prototype.hasOwnProperty.call(input, "credentials");
    await audit({ actorId: auth.session.sub, action: "compliance_vendor.updated", targetType: "compliance_vendor", targetId: id, metadata: { changedFields: Object.keys(input).filter((key) => key !== "credentials"), credentialsChanged: changedCredentials, enabled: vendor.is_enabled, dncBlockConfirmed: Boolean(removesDncAvailability && confirm_dnc_block === true) }, request });
    return NextResponse.json({ vendor });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update vendor" }, { status: 400 }); }
}

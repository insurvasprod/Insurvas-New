import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_COMPLIANCE_VENDORS } from "@/lib/compliance/permissions";
import { getComplianceVendorType, getEnabledDncVendorCount, updateComplianceVendor } from "@/lib/compliance/service";
import { updateComplianceVendorSchema } from "@/lib/compliance/schemas";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_COMPLIANCE_VENDORS);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = updateComplianceVendorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid vendor" }, { status: 400 });

  const { confirm_dnc_block, ...input } = parsed.data;
  const currentType = input.vendor_type ? await getComplianceVendorType(id).catch(() => null) : null;
  const removesDncAvailability = (Object.prototype.hasOwnProperty.call(input, "is_enabled") && input.is_enabled === false) || (currentType === "dnc_scrub" && input.vendor_type && input.vendor_type !== "dnc_scrub");
  if (removesDncAvailability) {
    const currentCount = await getEnabledDncVendorCount().catch(() => null);
    // The server re-check is the authority. A browser confirmation alone cannot bypass this rule,
    // and two admins changing the last DNC source cannot accidentally make the intent invisible.
    if (currentCount === 1 && confirm_dnc_block !== true) {
      return NextResponse.json({ requiresConfirmation: true, error: "This disables the last enabled DNC vendor. Dialing will be blocked platform-wide until another DNC vendor is enabled." }, { status: 409 });
    }
  }

  try {
    const vendor = await updateComplianceVendor(id, input);
    const changedCredentials = Object.prototype.hasOwnProperty.call(input, "credentials");
    await audit({ actorId: auth.session.sub, action: "compliance_vendor.updated", targetType: "compliance_vendor", targetId: id, metadata: { changedFields: Object.keys(input).filter((key) => key !== "credentials"), credentialsChanged: changedCredentials, enabled: vendor.is_enabled }, request });
    return NextResponse.json({ vendor });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update vendor" }, { status: 400 }); }
}

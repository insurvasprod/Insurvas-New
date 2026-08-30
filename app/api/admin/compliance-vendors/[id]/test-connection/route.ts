import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_COMPLIANCE_VENDORS } from "@/lib/compliance/permissions";
import { testComplianceVendor } from "@/lib/compliance/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_COMPLIANCE_VENDORS);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const result = await testComplianceVendor(id);
    await audit({ actorId: auth.session.sub, action: "compliance_vendor.connection_tested", targetType: "compliance_vendor", targetId: id, metadata: { ok: result.ok, category: result.category }, request });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ ok: false, category: "configuration", message: error instanceof Error ? error.message : "Could not test vendor" }, { status: 400 }); }
}

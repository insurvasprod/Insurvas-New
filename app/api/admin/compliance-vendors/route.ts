import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_COMPLIANCE_VENDORS } from "@/lib/compliance/permissions";
import { createComplianceVendor, listComplianceVendors } from "@/lib/compliance/service";
import { createComplianceVendorSchema } from "@/lib/compliance/schemas";

export async function GET() {
  const auth = await requireAdminRole(CAN_MANAGE_COMPLIANCE_VENDORS);
  if (auth instanceof NextResponse) return auth;
  try { return NextResponse.json({ vendors: await listComplianceVendors() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load vendors" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_COMPLIANCE_VENDORS);
  if (auth instanceof NextResponse) return auth;
  const parsed = createComplianceVendorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid vendor" }, { status: 400 });
  try {
    const vendor = await createComplianceVendor(parsed.data);
    await audit({ actorId: auth.session.sub, action: "compliance_vendor.created", targetType: "compliance_vendor", targetId: vendor.id, metadata: { name: vendor.name, vendorType: vendor.vendor_type, enabled: vendor.is_enabled, credentialsChanged: Boolean(parsed.data.credentials) }, request });
    return NextResponse.json({ vendor }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create vendor" }, { status: 400 }); }
}

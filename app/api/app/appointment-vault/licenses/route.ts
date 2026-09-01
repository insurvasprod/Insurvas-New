import { NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { licenseSchema } from "@/lib/appointments/schemas";
import { saveLicense } from "@/lib/appointments/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("appointment_vault", ["owner"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = licenseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid licence details" }, { status: 400 });
  try {
    const row = await saveLicense(auth.context.tenantId, parsed.data);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.license_saved", targetType: "license", targetId: row.id, metadata: { state: row.state, expiresAt: row.expires_at }, request });
    return NextResponse.json({ license: row }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save licence" }, { status: 400 }); }
}

import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { partnerSchema } from "@/lib/partners/schemas";
import { createPartner, listPartners } from "@/lib/partners/service";

const PARTNER_ROLES = ["owner", "bookkeeper"] as const;

export async function GET() {
  const auth = await requireFeatureRole("publisher_records", PARTNER_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json({ partners: await listPartners(auth.context.tenantId), readOnly: auth.entitlement.access === "read_only", partnerLimit: auth.entitlement.limits.max_partners ?? null });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load partners" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireFeatureRole("publisher_records", PARTNER_ROLES, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = partnerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Enter valid partner details" }, { status: 400 });
  try {
    const partner = await createPartner(auth.context.tenantId, auth.context.userId, parsed.data, auth.entitlement.limits.max_partners);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_created", targetType: "partner", targetId: partner.id, metadata: { name: partner.name, partnerType: partner.partner_type }, request });
    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create partner";
    const status = message.includes("partner_limit_reached") ? 409 : 400;
    return NextResponse.json({ error: status === 409 ? "Your plan has reached its partner limit." : message, code: status === 409 ? "partner_limit_reached" : "invalid_partner" }, { status });
  }
}

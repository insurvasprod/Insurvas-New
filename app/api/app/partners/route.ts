import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { partnerSchema } from "@/lib/partners/schemas";
import { createPartnerWithLimits, listPartners } from "@/lib/partners/service";
import { listPartnerUsers } from "@/lib/partnerUsers/service";

const PARTNER_ROLES = ["owner", "bookkeeper"] as const;

export async function GET() {
  const auth = await requireFeatureRole("publisher_records", PARTNER_ROLES);
  if (auth instanceof NextResponse) return auth;
  try {
    const partners = await listPartners(auth.context.tenantId);
    const directoryUsers = (await Promise.all(partners.map(async (partner) => {
      const users = await listPartnerUsers(auth.context.tenantId, partner.id);
      const adminsById = new Map(users.filter((user) => user.role === "partner_admin").map((user) => [user.user_id, user]));
      return users.map((user) => {
        const admin = user.partner_admin_user_id ? adminsById.get(user.partner_admin_user_id) : null;
        return { ...user, partner_id: partner.id, partner_name: partner.name, partner_admin_id: user.role === "partner_admin" ? null : admin?.user_id ?? null, partner_admin_name: user.role === "partner_admin" ? partner.name : admin?.name ?? null };
      });
    }))).flat();
    // The same rule create_partner_with_limits enforces: a draft holds a seat as well as an active
    // partner. Counting active only let the tile show room the server then refused.
    const holdsSeat = (status: string) => status === "draft" || status === "active";
    const usage = { publishers: partners.filter((p) => p.partner_type === "publisher" && holdsSeat(p.status)).length, marketing: partners.filter((p) => p.partner_type === "marketing" && holdsSeat(p.status)).length, affiliates: partners.filter((p) => p.partner_type === "affiliate" && holdsSeat(p.status)).length, partnerUsers: partners.filter((p) => p.status === "active").reduce((sum, p) => sum + p.active_user_count, 0) };
    return NextResponse.json({ partners, directoryUsers, readOnly: auth.entitlement.access === "read_only", limits: auth.entitlement.limits, usage });
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
    const partner = await createPartnerWithLimits(auth.context.tenantId, auth.context.userId, parsed.data, auth.entitlement.limits);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_created", targetType: "partner", targetId: partner.id, metadata: { name: partner.name, partnerType: partner.partner_type }, request });
    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create partner";
    const limit = message.match(/(max_publishers|max_marketing_partners|max_affiliates):(\d+):(\d+)/);
    if (message.includes("partner_limit_reached") && limit) return NextResponse.json({ error: `Your plan has reached ${limit[1]} (${limit[2]} of ${limit[3]}). Upgrade to add another partner.`, code: "limit_reached", limitKey: limit[1], usage: Number(limit[2]), limit: Number(limit[3]), upgrade: true }, { status: 403 });
    return NextResponse.json({ error: message, code: "invalid_partner" }, { status: 400 });
  }
}

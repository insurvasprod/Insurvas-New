import { NextResponse } from "next/server";

import { audit } from "@/lib/audit/log";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { partnerSchema } from "@/lib/partners/schemas";
import { createPartnerWithLimits, listPartners } from "@/lib/partners/service";
import { friendlyPartnerDbError } from "@/lib/partners/dbErrors";
import { listPartnerUsers } from "@/lib/partnerUsers/service";
import { parsePartnerLimitError, partnerLimitBody } from "@/lib/partnerLimits/copy";
import { PARTNER_TYPE_CAP_KEY, atPartnerCap, draftCompensatedLimit } from "@/lib/partnerLimits/rules";
import { countActivePartners } from "@/lib/partnerLimits/usage";

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
    // LA-1.19 (user decision): only an ACTIVE partner holds a slot — the count create, activate and
    // resume are checked against. A draft, a paused or an offboarded partner holds none.
    const active = (type: string) => partners.filter((p) => p.partner_type === type && p.status === "active").length;
    const usage = { publishers: active("publisher"), marketing: active("marketing"), affiliates: active("affiliate"), partnerUsers: partners.filter((p) => p.status === "active").reduce((sum, p) => sum + p.active_user_count, 0) };
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
  const tenantId = auth.context.tenantId;
  const limits = auth.entitlement.limits;
  const capKey = PARTNER_TYPE_CAP_KEY[parsed.data.partner_type];
  const cap = limits[capKey];
  let activeCount = 0;
  try {
    // The same count the usage figure shows. A draft made at the cap could never be activated, so
    // the create is refused there even though the draft itself would hold no slot.
    activeCount = cap == null ? 0 : await countActivePartners(tenantId, parsed.data.partner_type);
    if (atPartnerCap(activeCount, cap)) return NextResponse.json(partnerLimitBody(capKey, activeCount, cap as number, "add"), { status: 403 });
    let partner;
    try {
      partner = await createPartnerWithLimits(tenantId, auth.context.userId, parsed.data, limits);
    } catch (error) {
      const refused = parsePartnerLimitError(error instanceof Error ? error.message : "");
      const raised = refused && cap != null && refused.key === capKey ? draftCompensatedLimit(refused.used, activeCount, cap) : null;
      if (raised == null) throw error;
      partner = await createPartnerWithLimits(tenantId, auth.context.userId, parsed.data, { ...limits, [capKey]: raised });
    }
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_created", targetType: "partner", targetId: partner.id, metadata: { name: partner.name, partnerType: partner.partner_type }, request });
    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create partner";
    const limit = parsePartnerLimitError(message);
    // Said in the active count the page shows, never a pre-20260925709950 draft + active figure.
    const ours = limit?.key === capKey && cap != null;
    if (limit) return NextResponse.json(partnerLimitBody(limit.key, ours ? activeCount : limit.used, ours ? (cap as number) : limit.limit, "add"), { status: 403 });
    // Never raw Postgres text (W3.1): a database refusal is answered in words.
    return NextResponse.json({ error: friendlyPartnerDbError(message) ?? message, code: "invalid_partner" }, { status: 400 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CREDIT_METER_KEYS } from "@/lib/creditsLimits/constants";
import { updateCreditPack } from "@/lib/creditsLimits/service";

const roles = ["super_admin", "platform_config"] as const;
const schema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  meter_key: z.enum(CREDIT_METER_KEYS).optional(),
  quantity: z.number().int().positive().max(1_000_000_000).optional(),
  price_cents: z.number().int().nonnegative().max(2_000_000_000).optional(),
  is_active: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(roles);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid pack id" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) return NextResponse.json({ error: parsed.error?.issues[0]?.message ?? "No changes supplied" }, { status: 400 });
  try {
    const pack = await updateCreditPack(id, parsed.data);
    await audit({ actorId: auth.session.sub, action: parsed.data.is_active === false ? "credit_pack.archived" : "credit_pack.updated", targetType: "credit_pack", targetId: id, metadata: { fields: Object.keys(parsed.data) }, request });
    return NextResponse.json({ pack });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update credit pack" }, { status: 400 });
  }
}

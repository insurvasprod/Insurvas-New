import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { purchaseCreditPack } from "@/lib/creditsLimits/service";

const roles = ["super_admin", "platform_config"] as const;
const schema = z.object({
  tenant_id: z.string().uuid(),
  subscription_id: z.string().uuid().nullable().optional(),
  quantity: z.number().int().positive().max(1000),
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(roles);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid pack id" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid purchase" }, { status: 400 });
  try {
    const result = await purchaseCreditPack({ packId: id, tenantId: parsed.data.tenant_id, subscriptionId: parsed.data.subscription_id ?? null, quantity: parsed.data.quantity, reason: parsed.data.reason, createdBy: auth.session.sub });
    await audit({ actorId: auth.session.sub, action: "credit_pack.purchased", targetType: "invoice", targetId: result.invoiceId, reason: parsed.data.reason, metadata: { packId: id, tenantId: parsed.data.tenant_id, quantity: parsed.data.quantity, invoiceId: result.invoiceId, number: result.number, totalCents: result.totalCents }, request });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add pack to invoice" }, { status: 400 });
  }
}

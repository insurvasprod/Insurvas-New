import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CREDIT_METER_KEYS } from "@/lib/creditsLimits/constants";
import { createCreditPack, getCreditsLimitsData } from "@/lib/creditsLimits/service";

const roles = ["super_admin", "platform_config"] as const;
const meter = z.enum(CREDIT_METER_KEYS);
const packSchema = z.object({
  name: z.string().trim().min(1, "Pack name is required").max(160),
  meter_key: meter,
  quantity: z.number().int().positive().max(1_000_000_000),
  price_cents: z.number().int().nonnegative().max(2_000_000_000),
  is_active: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(roles);
  if (auth instanceof NextResponse) return auth;
  const over80 = new URL(request.url).searchParams.get("over80") === "true";
  try {
    return NextResponse.json(await getCreditsLimitsData(over80));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load credits and limits" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(roles);
  if (auth instanceof NextResponse) return auth;
  const parsed = packSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid pack" }, { status: 400 });
  try {
    const pack = await createCreditPack(parsed.data);
    await audit({ actorId: auth.session.sub, action: "credit_pack.created", targetType: "credit_pack", targetId: pack.id, metadata: { meterKey: pack.meter_key, quantity: pack.quantity, priceCents: pack.price_cents }, request });
    return NextResponse.json({ pack }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create credit pack" }, { status: 400 });
  }
}

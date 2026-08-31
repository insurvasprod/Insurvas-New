import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CREDIT_METER_KEYS } from "@/lib/creditsLimits/constants";
import { updateMeterPricing } from "@/lib/creditsLimits/service";

const roles = ["super_admin", "platform_config"] as const;
const schema = z.object({
  meter_key: z.enum(CREDIT_METER_KEYS),
  cost_cents: z.number().int().nonnegative().max(2_000_000_000).optional(),
  sell_cents: z.number().int().nonnegative().max(2_000_000_000),
  default_included: z.number().int().nonnegative().max(1_000_000_000).nullable(),
});

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminRole(roles);
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid meter pricing" }, { status: 400 });
  try {
    // DNC cost is authoritative from SA-4.8's enabled vendor registry. The service accepts no
    // browser-supplied replacement for that value; other meters may use the configured cost.
    const input = parsed.data.meter_key === "dnc_lookups" ? { ...parsed.data, cost_cents: undefined } : parsed.data;
    await updateMeterPricing({ ...input, updated_by: auth.session.sub });
    await audit({ actorId: auth.session.sub, action: "meter_pricing.updated", targetType: "meter_pricing", targetId: parsed.data.meter_key, metadata: { meterKey: parsed.data.meter_key, sellCents: parsed.data.sell_cents, defaultIncluded: parsed.data.default_included, costSource: parsed.data.meter_key === "dnc_lookups" ? "compliance_vendor" : "configured" }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update meter pricing" }, { status: 400 });
  }
}

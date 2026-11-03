import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { markVariance, readThreeTruths } from "@/lib/agency/moneyStores";
import { refusalResponse } from "@/lib/agency/rpc";
import { NO_STORE, periodOf } from "@/lib/agency/http";
import { audit } from "@/lib/audit/log";

/**
 * AG-1.12 · expected, reported and received per producer, never blended; variances over the threshold become
 * review items (?threshold= in cents, default $50). Nothing is corrected automatically.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper"]);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(request.url);
  const period = periodOf(url);
  if (period instanceof NextResponse) return period;
  const threshold = Number(url.searchParams.get("threshold") ?? "5000");
  if (!Number.isInteger(threshold) || threshold < 0) return NextResponse.json({ error: "The threshold is a whole number of cents." }, { status: 400 });
  try {
    return NextResponse.json({ period, threshold, ...(await readThreeTruths(auth.context.tenantId, period.from, period.to, threshold)) }, { headers: NO_STORE });
  } catch (error) {
    return refusalResponse(error);
  }
}

const markSchema = z.object({ itemId: z.string().uuid(), note: z.string().trim().min(1, "Write what you found").max(500) }).strict();

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("producer_payouts", ["owner", "bookkeeper"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = markSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the note" }, { status: 400 });
  try {
    await markVariance(auth.context.tenantId, parsed.data.itemId, parsed.data.note, auth.context.userId);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "agency.variance_reviewed", targetType: "variance", targetId: parsed.data.itemId, metadata: { tenantId: auth.context.tenantId }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return refusalResponse(error);
  }
}

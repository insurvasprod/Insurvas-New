import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { BUCKET_PENDING_MESSAGE, checkBucketNow, loadBucketView } from "@/lib/ingestion/bucketStore";
import { isoDate } from "@/lib/ingestion/path";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Carrier files › Bucket (LA-4.1's automated drop).
 *
 *   GET ?date=YYYY-MM-DD           the day's bucket files, as read, and the file monitor's open
 *                                  missing-file findings. Writes nothing; the page calls it every
 *                                  20 seconds while open.
 *   POST { action: "check_now" }   a run by hand over whatever is waiting (LA-4.19's manual trigger).
 *
 * Owner and bookkeeper, as Carrier files. A read-only account reads; it cannot run.
 */
const roles = ["owner", "bookkeeper"] as const;

const body = z.object({ action: z.literal("check_now"), date: z.string().optional() }).strict();

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles);
  if (auth instanceof NextResponse) return auth;
  const date = request.nextUrl.searchParams.get("date") ?? "";
  if (!isoDate(date)) return NextResponse.json({ error: "Choose a day." }, { status: 400 });
  try {
    const view = await loadBucketView(auth.context.tenantId, date);
    if (!view.available) return NextResponse.json({ error: BUCKET_PENDING_MESSAGE }, { status: 503 });
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[carrier-files/bucket] read", error);
    return NextResponse.json({ error: "The bucket could not be read" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose what to do." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  try {
    const outcome = await checkBucketNow(tenantId);
    await audit({ actorType: "tenant", actorId: userId, action: "tenant.carrier_bucket_checked", targetType: "tenant", targetId: tenantId, metadata: { tenantId, ...outcome }, request });
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    console.error("[carrier-files/bucket]", error);
    return NextResponse.json({ error: "The bucket could not be checked" }, { status: 500 });
  }
}

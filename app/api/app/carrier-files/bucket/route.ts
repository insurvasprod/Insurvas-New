import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { addExpectation, BUCKET_PENDING_MESSAGE, BucketError, checkBucketNow, loadBucketView, removeExpectation, saveBucketSettings, updateExpectation } from "@/lib/ingestion/bucketStore";
import { isoDate, isRecordUuid } from "@/lib/ingestion/path";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Carrier files › Bucket (2026-10-09).
 *
 *   GET ?date=YYYY-MM-DD                         the day: expected, received, missing, unexpected
 *                                                files, its checks and the settings. Writes nothing;
 *                                                the page calls it every 20 seconds while open.
 *   POST { action: "check_now", date }           removed files synced, one run over what arrived,
 *                                                the check recorded.
 *   POST { action: "save_settings", … }          check times and time zone.
 *   POST { action: "add_expectation" | "update_expectation" | "remove_expectation", … }
 *
 * Owner and bookkeeper, as Carrier files. A read-only account reads; it cannot check or change.
 */
const roles = ["owner", "bookkeeper"] as const;
const day = z.string().refine((value) => isoDate(value) !== null, "Choose a day.");
const uuid = z.string().refine(isRecordUuid, "Choose from the list.");
const weekdays = z.array(z.number().int().min(0).max(6)).min(1, "Choose at least one day of the week.").max(7);

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check_now"), date: day }).strict(),
  z.object({ action: z.literal("save_settings"), check_times: z.array(z.string()).max(24), timezone: z.string().min(1).max(64) }).strict(),
  z.object({ action: z.literal("add_expectation"), agency: z.string().min(1).max(120), carrier_id: uuid, file_type: z.enum(["policies", "commissions", "new_business"]), weekdays, active: z.boolean().default(true) }).strict(),
  z.object({ action: z.literal("update_expectation"), id: uuid, weekdays, active: z.boolean() }).strict(),
  z.object({ action: z.literal("remove_expectation"), id: uuid }).strict(),
], { message: "Choose what to do." });

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
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the request and try again." }, { status: 400 });
  const { tenantId, userId } = auth.context;
  const input = parsed.data;
  try {
    if (input.action === "check_now") {
      const outcome = await checkBucketNow(tenantId, userId, input.date);
      await audit({ actorType: "tenant", actorId: userId, action: "tenant.carrier_bucket_checked", targetType: "tenant", targetId: tenantId, metadata: { tenantId, date: input.date, ...outcome }, request });
      return NextResponse.json({ ok: true, ...outcome });
    }
    if (input.action === "save_settings") await saveBucketSettings(tenantId, userId, { checkTimes: input.check_times, timezone: input.timezone });
    else if (input.action === "add_expectation") await addExpectation(tenantId, userId, { agency: input.agency, carrierId: input.carrier_id, fileType: input.file_type, weekdays: input.weekdays, active: input.active });
    else if (input.action === "update_expectation") await updateExpectation(tenantId, input.id, { weekdays: input.weekdays, active: input.active });
    else await removeExpectation(tenantId, input.id);
    await audit({ actorType: "tenant", actorId: userId, action: "tenant.carrier_bucket_settings", targetType: "tenant", targetId: tenantId, metadata: { tenantId, change: input.action }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BucketError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[carrier-files/bucket]", error);
    return NextResponse.json({ error: "That could not be done" }, { status: 500 });
  }
}

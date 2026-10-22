import { NextResponse } from "next/server";

import { emitCredentialExpiry, processOutbox, sendDigests } from "@/lib/notifications/outbox";

/**
 * LA-8.4 (Notion sprint) · the notifications job: every few minutes, email what the outbox holds by
 * each person's choice, and send the daily and weekly digests that are due in their own timezone.
 * The E&O and licence check also runs here (pg_cron runs it too); its source keys make that harmless.
 *
 * Like every route under /api/cron, it needs a scheduler calling it with CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ?tenant=<uuid> runs one agency only (a test run); the E&O and licence check is every agency's, so it is skipped then.
  const tenant = new URL(request.url).searchParams.get("tenant");
  if (tenant && !/^[0-9a-f-]{36}$/i.test(tenant)) return NextResponse.json({ error: "tenant must be an id" }, { status: 400 });
  try {
    const credentials = tenant ? null : await emitCredentialExpiry();
    const outbox = await processOutbox(new Date(), tenant ?? undefined);
    const digests = await sendDigests(new Date(), tenant ?? undefined);
    return NextResponse.json({ tenant, credentials, outbox, digests });
  } catch (error) {
    console.error("[cron/notifications]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The notifications job failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { deliverDueWebhooks } from "@/lib/webhooks/deliver";

/**
 * LA-8.7 (Notion sprint) · the webhook delivery job: every minute, send what is due, retry what
 * failed on its ladder, and turn off what keeps failing (telling the agency).
 *
 * Like every route under /api/cron, it needs a scheduler calling it with CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ?tenant=<uuid> runs one agency only (a test run).
  const tenant = new URL(request.url).searchParams.get("tenant");
  if (tenant && !/^[0-9a-f-]{36}$/i.test(tenant)) return NextResponse.json({ error: "tenant must be an id" }, { status: 400 });
  try {
    return NextResponse.json({ tenant, ...(await deliverDueWebhooks({ tenantId: tenant ?? undefined, limit: 200 })) });
  } catch (error) {
    console.error("[cron/webhooks]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The webhook job failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { runPeriodBillingJob } from "@/lib/billing/job";

/**
 * The scheduled period billing run (backlog 24).
 *
 * Same shape as /api/cron/unclaimed-sla, deliberately: one CRON_SECRET, one convention, and an
 * operator who has learned how one scheduled job is invoked and authorised knows how both are.
 *
 * Fails closed. With no CRON_SECRET set this answers 401 to everybody including the scheduler,
 * which is noisy and safe, rather than running billing for anyone who finds the URL.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runPeriodBillingJob();
  return NextResponse.json(result.body, { status: result.status });
}

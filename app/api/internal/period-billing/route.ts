import { NextResponse } from "next/server";

import { runPeriodBillingJob, checkPeriodBillingHeartbeat } from "@/lib/billing/job";

/**
 * Is billing running, and run it by hand (backlog 24).
 *
 * GET is the heartbeat an external monitor polls. It answers 503 when the run is unhealthy, which
 * is the whole point: #24's observation is that a job that silently never runs looks identical to
 * a healthy one, and the only fix is an endpoint that says so out loud to something that is
 * watching. 200 means the job ran recently AND left nobody unbilled — see lib/billing/heartbeat.ts
 * for why both halves are needed.
 *
 * POST runs the job, for recovering from a missed window without waiting for the next one.
 *
 * Separate secret from CRON_SECRET. The scheduler's credential lives in the deployment provider's
 * cron configuration; this one is handed to a monitoring service and to whoever is on call, and
 * they should be revocable independently.
 */
function authorized(request: Request) {
  const expected = process.env.PERIOD_BILLING_SECRET;
  return Boolean(expected && request.headers.get("authorization") === `Bearer ${expected}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Clamped rather than trusted. A typo that set this to 2 would alert every few minutes forever;
  // one that set it to a year would never alert at all, which is the failure this endpoint exists
  // to prevent. Default is 36 hours: comfortably more than the daily cron's interval, so a single
  // missed run is not an alert, and two are.
  const maxAgeSeconds = Math.max(3_600, Math.min(Number(process.env.PERIOD_BILLING_HEARTBEAT_SECONDS ?? 129_600), 604_800));

  try {
    const result = await checkPeriodBillingHeartbeat(maxAgeSeconds);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("The period billing heartbeat could not be checked", error);
    return NextResponse.json({ error: "The period billing heartbeat could not be checked." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runPeriodBillingJob();
  return NextResponse.json(result.body, { status: result.status });
}

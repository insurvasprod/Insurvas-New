import { NextResponse } from "next/server";

import { runAssignmentRotationJob } from "@/lib/assignment/rotationJob";

/**
 * Lead assignment › "Attempts before rotate". Every 15 minutes (vercel.json), re-offers an owned
 * lead whose owner has made the tenant's configured number of unanswered attempts to a different
 * eligible agent, through the same router and gates as any assignment. Tenants with the setting off
 * are not touched. Before migration 20260924300000 it does nothing and says so.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runAssignmentRotationJob();
  return NextResponse.json(result.body, { status: result.status });
}

import { NextResponse } from "next/server";

import { runUnclaimedSlaJob } from "@/lib/queueSla/job";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runUnclaimedSlaJob();
  return NextResponse.json(result.body, { status: result.status });
}

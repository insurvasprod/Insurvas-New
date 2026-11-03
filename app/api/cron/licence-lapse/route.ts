import { NextResponse } from "next/server";

import { runLicenceLapseJob } from "@/lib/assignment/licenceLapseJob";

/**
 * Lead assignment › personal licence expiry. Hourly (vercel.json), returns an agent's open leads in
 * a state whose personal licence has lapsed to the pool, with the rotation job's guards: never
 * during a live call, an open attempt or a booked callback. Before migration 20260925702200 it does
 * nothing and says so.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runLicenceLapseJob();
  return NextResponse.json(result.body, { status: result.status });
}

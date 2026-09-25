import { NextResponse } from "next/server";
import { runUnclaimedSlaJob } from "@/lib/queueSla/job";
import { alertUnclaimedSlaOperator, getUnclaimedSlaHeartbeat } from "@/lib/queueSla/monitor";

function authorized(request: Request) {
  const expected = process.env.UNCLAIMED_SLA_SECRET;
  return Boolean(expected && request.headers.get("authorization") === `Bearer ${expected}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const maxAgeSeconds = Math.max(60, Math.min(Number(process.env.UNCLAIMED_SLA_HEARTBEAT_SECONDS ?? 900), 86_400));
  try {
    const heartbeat = await getUnclaimedSlaHeartbeat(maxAgeSeconds);
    if (!heartbeat.healthy) {
      const bucket = heartbeat.lastRunAt?.slice(0, 13) ?? new Date().toISOString().slice(0, 13);
      const alert = await alertUnclaimedSlaOperator({ reason: heartbeat.reason, detail: `The unclaimed lead SLA scheduler heartbeat is ${heartbeat.reason}. Last run: ${heartbeat.lastRunAt ?? "never"}.`, dedupeKey: `heartbeat:${heartbeat.reason}:${bucket}` });
      return NextResponse.json({ heartbeat, operatorAlert: alert }, { status: 503 });
    }
    return NextResponse.json({ heartbeat }, { status: 200 });
  } catch (error) {
    console.error("Unclaimed SLA heartbeat check failed", error);
    return NextResponse.json({ error: "Unclaimed lead SLA heartbeat could not be checked." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runUnclaimedSlaJob();
  return NextResponse.json(result.body, { status: result.status });
}

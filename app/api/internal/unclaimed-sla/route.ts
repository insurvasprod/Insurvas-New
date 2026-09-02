import { NextResponse } from "next/server";
import { processUnclaimedSla } from "@/lib/queueSla/service";

export async function POST(request: Request) {
  const expected = process.env.UNCLAIMED_SLA_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const report = await processUnclaimedSla();
    return NextResponse.json(report, { status: report.failures.length ? 503 : 200 });
  } catch (error) {
    console.error("Unclaimed SLA job failed", error);
    return NextResponse.json({ error: "Unclaimed lead SLA could not be processed." }, { status: 503 });
  }
}

import { NextResponse } from "next/server";
import { processCallbackReminders } from "@/lib/callbacks/reminders";

export async function POST(request: Request) {
  const expected = process.env.CALLBACK_REMINDER_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await processCallbackReminders()); }
  catch (error) { console.error("Callback reminder job failed", error); return NextResponse.json({ error: "Callback reminders could not be processed." }, { status: 503 }); }
}

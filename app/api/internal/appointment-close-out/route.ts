import { NextResponse } from "next/server";

import { processAppointmentCloseOut } from "@/lib/appointments/closeOut";

/**
 * LA-2.12, decision 12 · the scheduled close-out pass.
 *
 * Same shape and the same secret as the other internal jobs, so the deployment has one pattern to
 * schedule rather than three. Runs nightly: decision 12 says the strip appears "at the top of his
 * dashboard the next morning", so the pass has to have happened before he opens it.
 *
 * Idempotent, because `close_out_due_appointments` only touches appointments still at `booked` or
 * `confirmed` whose end time has passed. Running it twice in one night changes nothing the second
 * time, which is what makes it safe to retry rather than something to be careful about.
 */
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const summary = await processAppointmentCloseOut();
    // A partial failure is a 200 with the failures named, not a 503. The tenants that closed out
    // successfully did close out, and hiding that behind an error status would make the next run
    // look like the first.
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Appointment close-out job failed", error);
    return NextResponse.json(
      { error: "Appointment close-out could not be processed." },
      { status: 503 },
    );
  }
}

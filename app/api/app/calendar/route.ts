import { NextResponse, type NextRequest } from "next/server";

import { appointmentsInRange } from "@/lib/appointments/calendar";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * LA-2.11's day and week calendar.
 *
 * A setter is included. They book into this diary — LA-2.12's role table has "book appointments into
 * Ray's slots" on the Can side — and booking into a calendar you cannot see is how two setters put
 * two people in the same hour. What they may not do is change it, which is `/api/app/availability`
 * and excludes them.
 */
const CALENDAR_ROLES = ["owner", "producer", "setter"] as const;

/** A month of days at a time is plenty for a day-or-week view, and bounds the read. */
const MAX_DAYS = 31;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", CALENDAR_ROLES);
  if (auth instanceof NextResponse) return auth;

  const params = request.nextUrl.searchParams;
  const from = params.get("from");
  const to = params.get("to");
  const fromAt = from ? Date.parse(from) : NaN;
  const toAt = to ? Date.parse(to) : NaN;
  if (!Number.isFinite(fromAt) || !Number.isFinite(toAt))
    return NextResponse.json({ error: "Choose a valid date range" }, { status: 400 });
  if (toAt <= fromAt) return NextResponse.json({ error: "The range must end after it starts" }, { status: 400 });
  if (toAt - fromAt > MAX_DAYS * 86_400_000)
    return NextResponse.json({ error: `Choose a range of ${MAX_DAYS} days or fewer` }, { status: 400 });

  try {
    return NextResponse.json(
      { appointments: await appointmentsInRange(auth.context.tenantId, new Date(fromAt).toISOString(), new Date(toAt).toISOString()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the calendar" },
      { status: 500 },
    );
  }
}

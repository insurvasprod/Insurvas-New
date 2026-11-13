import { after, NextResponse, type NextRequest } from "next/server";

import { audit } from "@/lib/audit/log";
import { mirrorAgentUpcoming } from "@/lib/appointments/calendarMirror";
import { CalendarWrongWorkspaceError, completeCalendarConnection } from "@/lib/appointments/linkedCalendars";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * Where Google and Microsoft send the browser after consent (20260924230200). The person must be
 * signed in to the workspace that started the connection: the one-use `state` is matched to its
 * row, and that row's tenant to the session's, so a consent link cannot be completed into another
 * agency's calendar.
 */
export async function GET(request: NextRequest) {
  const back = (outcome: string) =>
    NextResponse.redirect(new URL(`/app/settings?calendar=${encodeURIComponent(outcome)}#calendar`, request.nextUrl.origin));

  const auth = await requireFeatureRole("outbound_dialing", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return back("signed_out");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back("declined");
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  if (!state || !code) return back("invalid");

  try {
    const done = await completeCalendarConnection({ state, code, tenantId: auth.context.tenantId });
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.calendar_linked",
      targetType: "tenant_connected_calendars",
      targetId: done.userId,
      metadata: { userId: done.userId },
      request,
    });
    // The meetings already booked go onto the newly linked calendar (a Google link that allowed it).
    after(() => mirrorAgentUpcoming(done.tenantId, done.userId).catch((error) => console.error("[calendar-mirror] upcoming", error instanceof Error ? error.message : error)));
    return back(done.readOnly ? "connected_read_only" : "connected");
  } catch (error) {
    if (error instanceof CalendarWrongWorkspaceError) return back("wrong_workspace");
    console.error("Calendar connection could not be completed", error instanceof Error ? error.message : error);
    return back("failed");
  }
}

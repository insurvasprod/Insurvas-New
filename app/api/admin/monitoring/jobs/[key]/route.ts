import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { fetchJobCalls } from "@/lib/adminMonitoring/jobsQueries";
import { isRunnableSlug } from "@/lib/adminMonitoring/jobsView";

/**
 * A job sheet's recent calls on Admin › Monitoring › Jobs & services (admin round 1, monitoring.html screen 6): when the
 * database called /api/cron/<key> and the answer to the latest call. Read-only; any staff role, as the dashboard's
 * Platform health tab. `key` must be one of the app jobs Platform health names; anything else is 404.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const auth = await requireAdminRole();
  if (auth instanceof NextResponse) return auth;

  const { key } = await params;
  if (!isRunnableSlug(key)) return NextResponse.json({ error: "Unknown job" }, { status: 404 });

  try {
    return NextResponse.json(await fetchJobCalls(`/api/cron/${key}`), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[monitoring/jobs] calls read failed", error);
    return NextResponse.json({ error: "Could not read the job's calls" }, { status: 500 });
  }
}

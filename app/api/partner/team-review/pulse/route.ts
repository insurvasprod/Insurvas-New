import { NextResponse, type NextRequest } from "next/server";

import { requirePartner } from "@/lib/partnerAuth/requirePartner";
import { partnerTeamPulse } from "@/lib/partnerTeamReview/service";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Team pulse for Team review (p-par-team-review): average reply time to the agent and the
 * conversations waiting on the team. Partner admins only, like the page, and read-only.
 * `from`/`to` are calendar days; `to` is inclusive.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePartner(["partner_admin"]);
  if (auth instanceof NextResponse) return auth;
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!from || !to || !DAY.test(from) || !DAY.test(to)) return NextResponse.json({ error: "Choose a valid review period" }, { status: 400 });
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T23:59:59.999Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 366 * 86_400_000) return NextResponse.json({ error: "Choose a review period of a year or less" }, { status: 400 });
  try {
    const pulse = await partnerTeamPulse(auth.context.tenantId, auth.context.partnerId, { from: start, to: end });
    return NextResponse.json(pulse, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Team pulse is unavailable right now" }, { status: 503 });
  }
}

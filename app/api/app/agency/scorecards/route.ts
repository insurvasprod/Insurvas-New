import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { producerScores } from "@/lib/agency/scorecardStore";
import { scopeFor } from "@/lib/agency/visibility";
import { NO_STORE, periodOf } from "@/lib/agency/http";
import { loadScorecards } from "@/lib/ingestion/scorecardsStore";
import { issued as isIssued } from "@/lib/ingestion/scorecards";

/**
 * AG-1.9 · producer scorecards, grouped from LA-4.18 and LA-7. A producer gets his own row only, a manager his
 * reports' (AG-0.4 scope): nobody sees a ranking he is not in.
 *
 * `?issued_days=1` (the phone's producer page, board I2 "Goal passed on 19 Nov") adds `issuedDays`: for each row
 * returned, the days in the period his policies were issued on with that day's issued annual premium — the same
 * policies and the same rule `issuedAnnualCents` sums, so the running total ends on it. Only rows the scope returns.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("producer_scorecards", ["owner", "bookkeeper", "producer"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const url = new URL(request.url);
  const period = periodOf(url);
  if (period instanceof NextResponse) return period;
  try {
    // The scope read in the auth round trip (the context copy below would miss it and read it again).
    const scores = producerScores({ ...auth.context, role: auth.context.role }, period, undefined, { scope: scopeFor(auth.context) });
    if (url.searchParams.get("issued_days") !== "1") return NextResponse.json(await scores, { headers: NO_STORE });
    const [answer, book] = await Promise.all([scores, loadScorecards({ tenantId: auth.context.tenantId, userId: auth.context.userId, role: "owner" }, period, { withSpend: false })]);
    const visible = new Set(answer.rows.map((r) => r.producerUserId));
    const issuedDays: Record<string, [string, number][]> = {};
    if ("policies" in book) {
      const byUser = new Map<string, Map<string, number>>();
      for (const p of book.policies) {
        if (!p.agentKey || !visible.has(p.agentKey) || !p.issueDate || p.issueDate < period.from || p.issueDate > period.to || !isIssued(p)) continue;
        const days = byUser.get(p.agentKey) ?? new Map<string, number>();
        days.set(p.issueDate, (days.get(p.issueDate) ?? 0) + (p.annualCents ?? 0));
        byUser.set(p.agentKey, days);
      }
      for (const [user, days] of byUser) issuedDays[user] = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }
    return NextResponse.json({ ...answer, issuedDays }, { headers: NO_STORE });
  } catch (error) {
    console.error("[producer scorecards]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load the scorecards" }, { status: 500 });
  }
}

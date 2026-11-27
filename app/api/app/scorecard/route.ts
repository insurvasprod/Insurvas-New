import { NextResponse, type NextRequest } from "next/server";

import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getRoster, getScorecard } from "@/lib/setters/service";
import { anyRoleHasPermission } from "@/lib/tenantAuth/permissions";
import { contextRoles } from "@/lib/tenantAuth/requireTenant";
import { scopeFor } from "@/lib/agency/visibility";
import { loadScoreCases } from "@/lib/retention/cases/store";
import { caseScorecard, type ScoreLine } from "@/lib/retention/cases/scorecard";
import { REASON_LABELS, type Reason } from "@/lib/retention/cases/ladder";
import { LADDER_PENDING_MESSAGE } from "@/lib/retention/cases/sync";

// LA-2.12. Every role that has a scorecard at all, which is not the same as every role that sees
// the team's: the scope is decided inside the service from the caller's role, so a setter reaching
// this route gets their own rows and a bookkeeper does not reach it at all.
const SCORECARD_ROLES = ["owner", "producer", "setter"] as const;

// `?kind=retention` · the Retention scorecard for this calendar month (mobile board I4c): the ladder's cases, behind
// the Retention module's own feature (as GET /api/app/retention/cases). Owner and producer: the retention role is
// kept to its LA-5 work routes (moneyRoutes.test.mjs RETENTION_ROUTES), so a rep's phone reads the ladder's own
// scorecard (?scorecard=90) instead.
const RETENTION_ROLES = ["owner", "producer"] as const;

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("kind") === "retention") return retentionMonth();
  const auth = await requireTenant(SCORECARD_ROLES);
  if (auth instanceof NextResponse) return auth;

  const days = Number(request.nextUrl.searchParams.get("days") ?? "30");
  const sinceDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 1), 180) : 30;

  try {
    // AG-0.5: inside an agency the team view is narrowed to the members in the session's scope (a
    // producer sees himself, a manager his reports); from the session, never a parameter. Null = as before.
    const scope = await scopeFor(auth.context);
    const scorecard = await getScorecard(auth.context.tenantId, auth.context.userId, auth.context.role, sinceDays, scope);
    // The roster is the owner's view of who is on shift. A setter sees their own numbers, not a
    // list of their colleagues' working hours.
    const roster = anyRoleHasPermission(contextRoles(auth.context), "scorecard.view.all")
      ? await getRoster(auth.context.tenantId, scope, auth.context.userId)
      : [];
    return NextResponse.json({ ...scorecard, roster }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load the scorecard" }, { status: 503 });
  }
}

/**
 * This month on the Retention ladder, in counts (no premium): the cases worked — open now, or decided since the
 * 1st — saved, lost, still open and unreachable, with the save rate by the reason the case was opened for and by
 * person. The rates follow the scorecard's rule (saved ÷ saved + lost, a rate only over 10 decided). An owner sees
 * everyone's cases; anyone else only their own, as on the web's Retention scorecard.
 */
async function retentionMonth() {
  const auth = await requireFeatureRole("chargeback_radar", RETENTION_ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const headers = { "Cache-Control": "no-store" };
  const { tenantId, userId, role } = auth.context;
  const now = new Date();
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  try {
    const scored = await loadScoreCases({ tenantId, userId, role, scope: await scopeFor(auth.context) }, now.getUTCDate());
    if (!scored) return NextResponse.json({ available: false, message: LADDER_PENDING_MESSAGE }, { headers });
    const mine = (role === "owner" ? scored.cases : scored.cases.filter((c) => c.ownerId === userId))
      .filter((c) => c.resolvedAt === null || c.resolvedAt.slice(0, 10) >= monthStart);
    const score = (rows: typeof mine) => caseScorecard(rows.map((c) => ({ ownerId: c.ownerId, step: c.step, status: c.status, unreachable: c.unreachable, monthlyCents: 0 })));
    const counts = (l: ScoreLine) => ({ key: l.key, open: l.open, saved: l.saved, lost: l.lost, closedNoSave: l.closedNoSave, unreachable: l.unreachable, rate: l.rate });
    const card = score(mine);
    const byReason = new Map<string, typeof mine>();
    for (const c of mine) byReason.set(c.reason, [...(byReason.get(c.reason) ?? []), c]);
    const reasons = [...byReason.entries()]
      .map(([key, rows]) => ({ ...counts({ ...score(rows).total, key }), label: REASON_LABELS[key as Reason] ?? key }))
      .sort((a, b) => b.saved + b.lost - (a.saved + a.lost) || b.open - a.open);
    return NextResponse.json({
      available: true,
      month: monthStart.slice(0, 7),
      total: counts(card.total),
      reasons,
      people: card.people.map((l) => ({ ...counts(l), name: l.key === "nobody" ? "Nobody yet" : scored.names.get(l.key) ?? (l.key === userId ? "You" : "Someone no longer here") })),
    }, { headers });
  } catch (error) {
    console.error("[scorecard retention]", error);
    return NextResponse.json({ error: "The scorecard could not be read" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { scopeFor } from "@/lib/agency/visibility";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { heldRoles, seesMoney } from "@/lib/dashboard/access";
import { dayIn } from "@/lib/dashboard/views/book";
import { inForce, type BookRow } from "@/lib/ingestion/policyBook";
import { loadBook, loadHandPolicies, loadIssuedAwaiting } from "@/lib/ingestion/policyBookStore";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

/**
 * The phone's producer Home (mobile board B1): the two figures it draws from the book, read the way the web's Home
 * reads them (lib/dashboard/views/book.ts loadBookView → the Policies list's rows for this reader):
 *
 *   issued          policies issued per issue date from the 1st of last month (and at least the last two weeks) to
 *                   today: count and annual premium, for the "This week" Issued premium tile and the month's goal
 *                   ring (the web's issuedIn: by issue date, annual premium; without a goal the ring reads last
 *                   month). Premium only for a reader who sees money (lib/dashboard/access seesMoney).
 *   paymentMissed   policies in force whose premium is late (days past due) and that the carrier has not closed
 *                   yet, with the nearest day the carrier closes one ("Save by 2 Dec"), from policy_current's
 *                   countdown (days_until_carrier_closes, as of the daily refresh).
 *
 * Read only. Owner and producer on the book's own feature, as the Policies list; a producer reaches only the
 * policies credited to him (in the store), a narrowed agency session only its scope's, from the session.
 */
const ROLES = ["owner", "producer"] as const;
const WEEKS_DAYS = 14;

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const auth = await requireFeatureRole("book_of_business", ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId, role } = auth.context;
  try {
    const viewer = { tenantId, userId, role, scope: await scopeFor(auth.context) };
    const [book, hand, issued, zone] = await Promise.all([
      loadBook(viewer),
      loadHandPolicies(viewer),
      loadIssuedAwaiting(viewer).catch(() => [] as BookRow[]),
      getWorkspaceTimezone(tenantId).catch(() => null),
    ]);
    const rows: BookRow[] = [...(book.available ? book.rows : []), ...hand, ...issued];
    const today = dayIn(zone ?? "UTC", Date.now());
    // The 1st of last month, or two weeks back when that is earlier (this week and last, early in a month).
    const firstOfLast = (() => { const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
    const twoWeeks = addDays(today, -WEEKS_DAYS);
    const since = firstOfLast < twoWeeks ? firstOfLast : twoWeeks;
    const money = seesMoney(heldRoles(auth.context));

    const byDay = new Map<string, { day: string; count: number; cents: number }>();
    for (const row of rows) {
      const day = row.issueDate?.slice(0, 10);
      if (!day || day < since || day > today) continue;
      const at = byDay.get(day) ?? { day, count: 0, cents: 0 };
      at.count += 1;
      at.cents += row.annualCents ?? 0;
      byDay.set(day, at);
    }
    const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ day: d.day, count: d.count, cents: money ? d.cents : null }));

    const late = rows.filter((row) => inForce(row.status) && (row.daysPastDue ?? 0) > 0 && (row.daysLeft === null || row.daysLeft >= 0));
    const left = late.map((row) => row.daysLeft).filter((n): n is number => n !== null);
    const soonest = left.length ? Math.min(...left) : null;

    return NextResponse.json(
      {
        today,
        money,
        available: book.available,
        issued: { since, days },
        paymentMissed: { count: late.length, saveBy: soonest === null ? null : addDays(today, soonest) },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[home producer]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not load your book" }, { status: 500 });
  }
}

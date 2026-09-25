import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { fetchSubscriptionsBoard } from "@/lib/subscriptionsList/board";
import { formatCentsAsCurrency } from "@/lib/money";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { SubscriptionsList } from "@/components/admin/subscriptions-list";
import { Callout } from "@/components/app/settings/primitives";

/**
 * Admin Subscriptions (board p-adm-subscriptions): four figures, the toolbar, every subscription
 * with its current period and what is queued to change, and the callout on why the list is
 * read-only. Every figure is read from the database on each request; the board's names and
 * numbers are samples.
 */
export default async function SubscriptionsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageSubscriptions(admin.role)) redirect("/admin");

  const board = await fetchSubscriptionsBoard();
  const { figures, listError } = board;
  const unread = "could not be read";

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        title="Subscriptions"
        subtitle="Who is on what, and what is queued to change. Assign and cancel from a tenant’s page."
      />

      <BoardStatGrid>
        <BoardStatTile
          label="Active"
          value={listError ? "—" : figures.active}
          tone={!listError && figures.active > 0 ? "success" : "default"}
          footnote={
            listError
              ? unread
              : figures.activePlans === 0
                ? "none active"
                : `across ${figures.activePlans} ${figures.activePlans === 1 ? "plan" : "plans"}`
          }
          title="Subscriptions in the Active state. Plans are counted once whatever their version. Past due, paused and suspended subscriptions are not included."
        />
        <BoardStatTile
          label="Trialling"
          value={listError ? "—" : figures.trialling}
          tone={!listError && figures.trialling > 0 ? "warning" : "default"}
          footnote={listError ? unread : figures.trialling === 0 ? "none in trial" : `${figures.trialsEndingThisWeek} end this week`}
          title="Subscriptions on trial. “End this week” counts trials whose end falls in the next 7 days, including any already past their end date."
        />
        <BoardStatTile
          label="Cancelled, still in period"
          value={listError ? "—" : figures.endingInPeriod}
          footnote={listError ? unread : "access until period end"}
          title="Cancelled at the period end: full access until the period ends, then the period roll ends the subscription."
        />
        <BoardStatTile
          label="MRR"
          value={listError || figures.mrrCents === null ? "—" : formatCentsAsCurrency(figures.mrrCents)}
          footnote={listError || figures.mrrCents === null ? unread : "contracted"}
          title="Live, at list price: each Active, Past due or Cancelled-in-period subscription's plan price per month, the way the revenue dashboard counts it (before coupons). The Revenue page reads the nightly snapshot, so the two can differ by today's changes."
        />
      </BoardStatGrid>

      <SubscriptionsList rows={board.rows} plans={board.plans} listError={listError} />

      <Callout tone="warning" title="Cancelled and expired are different facts, and both belong">
        A cancelled subscription keeps access until its period ends; an expired one has ended. Assign and cancel live on the tenant
        page on purpose — a destructive money action belongs next to the customer it affects, not in a list where the wrong row is
        one mis-click away.
      </Callout>
    </div>
  );
}

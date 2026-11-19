import { redirect } from "next/navigation";

import { BillingPage } from "@/components/admin/billing/billing-page";
import { SubsLensTabs } from "@/components/admin/billing/subs-lens-tabs";
import { SubsSheetBody } from "@/components/admin/billing/subs-sheet";
import { SubscriptionsList } from "@/components/admin/subscriptions-list";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { formatCentsAsCurrency } from "@/lib/money";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { fetchSubscriptionsBoard } from "@/lib/subscriptionsList/board";
import { lensCounts } from "@/lib/subscriptionsList/filters";
import { fetchSubscriptionSheet, type SubscriptionSheetData } from "@/lib/subscriptionsList/sheet";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/**
 * Admin › Billing › Subscriptions (admin round 1, docs/design/admin-r1/billing-r2.html screen 2): the four figures,
 * then every subscription with its current period, what is queued to change and what it is worth a month. Filters
 * and the lens live in the address; a row opens its sheet (`?open=`), which can act with the customer record's own
 * actions under the same roles. Every figure is read from the database on each request.
 */
export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageSubscriptions(admin.role)) redirect("/admin");

  const params = await searchParams;
  const openParam = typeof params.open === "string" && UUID.test(params.open) ? params.open : null;

  const [board, sheet] = await Promise.all([
    fetchSubscriptionsBoard(),
    openParam
      ? fetchSubscriptionSheet(openParam, { id: admin.id, role: admin.role }).then(
          (data): { data: SubscriptionSheetData | null; failed: boolean } => ({ data, failed: false }),
          (error: unknown) => {
            console.error("[admin/subscriptions] sheet read failed:", error instanceof Error ? error.message : error);
            return { data: null, failed: true };
          },
        )
      : Promise.resolve(null),
  ]);
  const { figures, listError } = board;
  const unread = "could not be read";

  const sheetBody = !openParam || !sheet
    ? null
    : sheet.failed
      ? <p className="m-0 p-4 text-sm text-muted-foreground">This subscription could not be read just now. Close the sheet and open it again.</p>
      : <SubsSheetBody data={sheet.data} row={board.rows.find((row) => row.id === openParam) ?? null} />;

  return (
    <BillingPage
      step="subscriptions"
      info="Who is on what, and what is queued to change. A row opens the subscription, where it can be changed."
      tabs={<SubsLensTabs counts={listError ? null : lensCounts(board.rows)} />}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Subscription totals">
          <StatTile
            label="Active"
            value={listError ? "—" : figures.active}
            footnote={listError ? unread : figures.activePlans === 0 ? "none active" : `across ${plural(figures.activePlans, "plan")}`}
            labelTitle="Subscriptions in the Active state. Plans are counted once whatever their version. Past due, paused and suspended subscriptions are not included."
          />
          <StatTile
            label="Trialling"
            value={listError ? "—" : figures.trialling}
            footnote={listError ? unread : figures.trialling === 0 ? "none in trial" : `${figures.trialsEndingThisWeek} end this week`}
            labelTitle="Subscriptions on trial. “End this week” counts trials whose end falls in the next 7 days, including any already past their end date."
            href="/admin/trials"
          />
          <StatTile
            label="Cancelled, still in period"
            value={listError ? "—" : figures.endingInPeriod}
            footnote={listError ? unread : "access until period end"}
            labelTitle="Cancelled at the period end: full access until the period ends, then the period roll ends the subscription."
            href="/admin/subscriptions?lens=cancelling"
          />
          <StatTile
            label="MRR · live"
            value={listError || figures.mrrCents === null ? "—" : formatCentsAsCurrency(figures.mrrCents)}
            footnote={listError || figures.mrrCents === null ? unread : "at list price"}
            labelTitle="Live, at list price: each Active, Past due or Cancelled-in-period subscription's plan price per month, the way the revenue dashboard counts it (before coupons). The Revenue page reads the nightly snapshot, so the two can differ by today's changes."
          />
        </StatStrip>

        <SubscriptionsList rows={board.rows} plans={board.plans} listError={listError} sheet={sheetBody} sheetFor={openParam} />
      </div>
    </BillingPage>
  );
}

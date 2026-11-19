import { redirect } from "next/navigation";

import { BillingPage } from "@/components/admin/billing/billing-page";
import { FailedList, type FailedLens } from "@/components/admin/billing/failed-list";
import { ErrorState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { fetchFailedPaymentsBoard, type FailedPaymentsBoard } from "@/lib/failedPayments/reads";
import { formatCentsAsCurrency } from "@/lib/money";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";

const LENSES: readonly { key: FailedLens; label: string }[] = [
  { key: "past_due", label: "Past due" },
  { key: "recovered", label: "Recovered" },
  { key: "lost", label: "Lost" },
];

/** The board and the clock it was read at, or null when the past-due list could not be read. */
async function readBoard(): Promise<{ board: FailedPaymentsBoard; now: number } | null> {
  const now = Date.now();
  try {
    return { board: await fetchFailedPaymentsBoard(now), now };
  } catch (error) {
    console.error("[admin/failed-payments]", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Admin › Billing › Failed payments (admin round 1, docs/design/admin-r1/billing-r2.html screen 4; Notion §6.5, the
 * dunning queue). Every customer whose payment failed, why, where they are on the provider's retry ladder and
 * what happens next; and the failures recovered or lost over 90 days. Same gate as Subscriptions.
 */
export default async function FailedPaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageSubscriptions(admin.role)) redirect("/admin");

  const params = await searchParams;
  const lens: FailedLens = params.lens === "recovered" || params.lens === "lost" ? params.lens : "past_due";
  const read = await readBoard();

  const info = "Every customer whose payment failed, why, and where they are on the payment provider's retry ladder; and the failures recovered or lost over 90 days.";
  if (!read) {
    return (
      <BillingPage step="failed" info={info}>
        <div className="flex w-full min-w-0 flex-col gap-4">
          <TableCard><ErrorState title="Couldn't load failed payments" detail="The read did not answer. Reload the page; if it keeps failing, the error is in the server log." /></TableCard>
        </div>
      </BillingPage>
    );
  }

  const { board, now } = read;
  const { pastDue, figures } = board;
  const atRisk = pastDue.reduce((sum, row) => sum + (row.invoice?.totalCents ?? row.amountCents ?? 0), 0);
  const tabs = LENSES.map((item) => ({
    key: item.key,
    label: item.label,
    href: item.key === "past_due" ? "/admin/billing/failed-payments" : `/admin/billing/failed-payments?lens=${item.key}`,
    count: item.key === "past_due" ? pastDue.length : item.key === "recovered" ? board.recovered?.length ?? null : board.lost?.length ?? null,
    tone: item.key === "past_due" ? ("danger" as const) : undefined,
  }));

  return (
    <BillingPage step="failed" info={info} tabs={<ViewTabs label="Failed payment views" tabs={tabs} value={lens} />}>
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Failed payment totals">
          <StatTile label="Past due" value={pastDue.length} footnote={pastDue.length ? `${formatCentsAsCurrency(atRisk)} at risk` : "nothing at risk"} href={lens === "past_due" ? undefined : "/admin/billing/failed-payments"} />
          <StatTile
            label="Recovered · 30 days"
            value={figures ? figures.recovered30 : "—"}
            delta={figures && (figures.recovered30 || figures.recoveredPrior30) ? { value: figures.recovered30 - figures.recoveredPrior30, unit: "", goodWhen: "up" } : undefined}
            footnote={figures ? "paid after failing" : "couldn't be read"}
            labelTitle="Customers whose payment went through after one or more failures, in the last 30 days. The change is against the 30 days before."
            href={lens === "recovered" ? undefined : "/admin/billing/failed-payments?lens=recovered"}
          />
          <StatTile
            label="Lost · 30 days"
            value={figures ? figures.lost30 : "—"}
            footnote={figures ? "cancelled after the last retry" : "couldn't be read"}
            labelTitle="Customers whose subscription was suspended or cancelled after failing, with no payment since, in the last 30 days."
            href={lens === "lost" ? undefined : "/admin/billing/failed-payments?lens=lost"}
          />
          <StatTile
            label="Recovery rate"
            value={figures?.rate90 == null ? "—" : `${Math.round(figures.rate90 * 100)}%`}
            footnote={figures === null ? "couldn't be read" : figures.rate90 === null ? "no failure has closed yet" : "90 days"}
            labelTitle="Of the failures that closed in the last 90 days, the share recovered rather than lost."
          />
        </StatStrip>

        <FailedList lens={lens} pastDue={pastDue} recovered={board.recovered} lost={board.lost} now={now} />
      </div>
    </BillingPage>
  );
}

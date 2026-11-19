import { redirect } from "next/navigation";

import { BillingPage } from "@/components/admin/billing/billing-page";
import { TrialsTable } from "@/components/admin/trials-table";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { fetchTrialsBoard } from "@/lib/trials/board";
import { ENDING_SOON_DAYS, percentLabel } from "@/lib/trials/boardModel";

const n = (value: number) => value.toLocaleString("en-US");

/**
 * Admin › Billing › Trials (admin round 1, docs/design/admin-r1/billing-r2.html screen 3): the four figures, then
 * the trials in flight. Filters live in the address; a row opens its sheet with the owner, the card, the signals
 * and Extend, Convert, Cancel; ticking rows extends or reminds several at once. Every figure is read from the
 * database on each request.
 */
export default async function TrialsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canManageSubscriptions(admin.role)) redirect("/admin");

  const board = await fetchTrialsBoard();
  const { figures } = board;
  const endedThisMonth = figures.month.converted + figures.month.lapsed;
  const convertedShare = endedThisMonth === 0 ? null : figures.month.converted / endedThisMonth;
  const lapsedShare = endedThisMonth === 0 ? null : figures.month.lapsed / endedThisMonth;
  const monthHover =
    "Trials that ended this calendar month (UTC), dated by the recorded moment the trial converted or lapsed. Trials that ended before that was recorded are dated by the first successful payment (conversion) or the cancellation (lapse), falling back to the trial end.";
  const soon = board.rows.filter((row) => row.daysLeft <= ENDING_SOON_DAYS);
  const soonNoCard = soon.filter((row) => !row.hasPaymentMethod).length;

  return (
    <BillingPage step="trials" info="Every trial in flight, fewest days left first, with what each customer has set up and whether a card is on file.">
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <StatStrip label="Trial totals">
          <StatTile
            label="In trial"
            value={board.listError ? "—" : figures.inTrial}
            footnote={board.listError ? "could not be read" : figures.planCount === 0 ? "none in flight" : `across ${figures.planCount} ${figures.planCount === 1 ? "plan" : "plans"}`}
          />
          <StatTile
            label={`Ending in ${ENDING_SOON_DAYS} days`}
            value={board.listError ? "—" : figures.endingSoon}
            footnote={board.listError ? "could not be read" : figures.endingSoon > 0 ? `${n(soonNoCard)} with no card` : "none this close"}
            labelTitle="Trials in flight with three or fewer calendar days left (UTC), including any past their end date."
            href={figures.endingSoon > 0 ? "/admin/trials?ends=soon" : undefined}
          />
          <StatTile
            label="Converted this month"
            value={board.statsAvailable ? figures.month.converted : "—"}
            footnote={!board.statsAvailable ? "could not be read" : convertedShare === null ? "no trial has ended this month" : `${percentLabel(convertedShare)} of trials ended`}
            labelTitle={monthHover}
          />
          <StatTile
            label="Lapsed this month"
            value={board.statsAvailable ? figures.month.lapsed : "—"}
            footnote={!board.statsAvailable ? "could not be read" : lapsedShare === null ? "—" : percentLabel(lapsedShare)}
            labelTitle={monthHover}
          />
        </StatStrip>

        <TrialsTable rows={board.rows} canManage={canManageSubscriptions(admin.role)} signalsAvailable={board.signalsAvailable} listError={board.listError} history={board.history} />
      </div>
    </BillingPage>
  );
}

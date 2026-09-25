import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { fetchTrialsBoard, type TrialsBoard } from "@/lib/trials/board";
import { endsInPhrase, percentLabel, rate } from "@/lib/trials/boardModel";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { TrialsTable } from "@/components/admin/trials-table";
import { Callout, KeyValues, SettingsCard } from "@/components/app/settings/primitives";

/**
 * Admin Trials (board p-adm-trials): four figures, the toolbar, the trials in flight, and the
 * callout on what separates the trials that convert. Every figure is read from the database on
 * each request; the board's names and numbers are samples.
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

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader title="Trials" subtitle="Trials in flight, and what separates the ones that convert." />

      <BoardStatGrid>
        <BoardStatTile
          label="In trial"
          value={board.listError ? "—" : figures.inTrial}
          footnote={
            board.listError
              ? "could not be read"
              : figures.planCount === 0
                ? "none in flight"
                : `across ${figures.planCount} ${figures.planCount === 1 ? "plan" : "plans"}`
          }
        />
        <BoardStatTile
          label="Ending in 3 days"
          value={board.listError ? "—" : figures.endingSoon}
          tone={figures.endingSoon > 0 ? "error" : "default"}
          footnote={board.listError ? "could not be read" : figures.endingSoon > 0 ? "act today" : "none this close"}
          title="Trials in flight with three or fewer calendar days left (UTC), including any past their end date."
        />
        <BoardStatTile
          label="Converted this month"
          value={board.statsAvailable ? figures.month.converted : "—"}
          tone={board.statsAvailable && figures.month.converted > 0 ? "success" : "default"}
          footnote={
            !board.statsAvailable
              ? "could not be read"
              : convertedShare === null
                ? "no trial has ended this month"
                : `${percentLabel(convertedShare)} of trials ended this month`
          }
          title={monthHover}
        />
        <BoardStatTile
          label="Lapsed this month"
          value={board.statsAvailable ? figures.month.lapsed : "—"}
          tone={board.statsAvailable && figures.month.lapsed > 0 ? "warning" : "default"}
          footnote={!board.statsAvailable ? "could not be read" : lapsedShare === null ? "—" : percentLabel(lapsedShare)}
          title={monthHover}
        />
      </BoardStatGrid>

      <TrialsTable
        rows={board.rows}
        canManage={canManageSubscriptions(admin.role)}
        signalsAvailable={board.signalsAvailable}
        listError={board.listError}
      />

      <SeparationCallout board={board} />

      {board.separation && board.separation.cohort > 0 && (
        <SettingsCard
          pad={20}
          title="Conversion by owner sign-in"
          sub="The same ended trials. Sign-in means the owner has signed in at least once — not setup progress, which nothing records."
        >
          <KeyValues
            items={[
              {
                label: "Owner signed in at least once",
                value: ratioLabel(board.separation.ownerSignedIn),
              },
              {
                label: "Owner never signed in",
                value: ratioLabel(board.separation.ownerNeverSignedIn),
              },
              {
                label: "Average trial length before converting",
                value: board.separation.averageDaysToConvert === null ? "—" : `${board.separation.averageDaysToConvert} days`,
              },
            ]}
          />
        </SettingsCard>
      )}
    </div>
  );
}

function ratioLabel(ratio: { n: number; converted: number }): string {
  return ratio.n === 0 ? "—" : `${ratio.converted} of ${ratio.n} converted (${percentLabel(rate(ratio))})`;
}

/** "(3 of 4)" — the sample behind a rate, printed because these samples are small. */
function sample(ratio: { n: number; converted: number }): string {
  return `(${ratio.converted} of ${ratio.n})`;
}

/**
 * The board's callout, from the database: of the trials that started in the last six months and
 * have ended, how the ones that imported leads and invited a second user converted, against the
 * ones that did neither — then the trial in flight that most needs a call.
 */
function SeparationCallout({ board }: { board: TrialsBoard }) {
  const sep = board.separation;
  const heading = "What separates the trials that convert";

  if (!sep) {
    return (
      <Callout tone="info" title={heading}>
        The activation signals or the ended trials could not be read, so there is no comparison to show.
      </Callout>
    );
  }

  const spotlight = board.spotlight ? (
    <>
      {" "}
      {board.spotlight.name} has done neither and {endsInPhrase(board.spotlight.daysLeft, board.spotlight.overdue)}.
      {board.spotlight.others > 0 &&
        ` ${board.spotlight.others} more ${board.spotlight.others === 1 ? "trial" : "trials"} in flight ${
          board.spotlight.others === 1 ? "has" : "have"
        } done neither.`}
    </>
  ) : board.rows.length > 0 ? (
    " Every trial in flight has done at least one of the two."
  ) : null;

  if (sep.cohort === 0) {
    return (
      <Callout tone="info" title={`${heading} — last 6 months`}>
        No trial that started in the last 6 months has ended yet, so there is nothing to compare.
        {spotlight}
      </Callout>
    );
  }

  return (
    <Callout
      tone="info"
      title={`${heading} — ${sep.cohort.toLocaleString()} ended ${sep.cohort === 1 ? "trial" : "trials"}, last 6 months`}
    >
      {sep.both.n > 0 ? (
        <>
          A trial that imported leads <strong>and</strong> invited a second user converts at{" "}
          <strong>{percentLabel(rate(sep.both))}</strong> {sample(sep.both)}.
        </>
      ) : (
        <>
          No ended trial imported leads <strong>and</strong> invited a second user.
        </>
      )}{" "}
      {sep.neither.n > 0 ? (
        <>
          {sep.both.n > 0 ? "One" : "A trial"} that did neither converts at <strong>{percentLabel(rate(sep.neither))}</strong>{" "}
          {sample(sep.neither)}.
        </>
      ) : (
        "Every ended trial did at least one of the two."
      )}
      {spotlight}
    </Callout>
  );
}

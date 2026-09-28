import { redirect } from "next/navigation";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canManageSubscriptions } from "@/lib/subscriptions/permissions";
import { fetchTrialsBoard } from "@/lib/trials/board";
import { percentLabel } from "@/lib/trials/boardModel";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { TrialsTable } from "@/components/admin/trials-table";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Admin Trials (board p-adm-trials): four figures, then the trials in flight. Every figure is read from the database on
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
      <PageHeader title="Trials" />

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
    </div>
  );
}

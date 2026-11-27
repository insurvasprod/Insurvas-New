import { useState } from "react";
import { router } from "expo-router";

import { GroupBox } from "@/components/home/parts";
import { Chip, Failed, Loading, Row, Screen, SectionHead, Strip, Tile } from "@/components/ui";
import { compactCount } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { barLabels, depositsPath, waitingRows, axisDay, type DepositsAnswer } from "./bookkeeper-logic";
import { CashBars, CashCard, MoneyStripTile } from "./bookkeeper-parts";
import { dayKey, depositsShort, dollars, lateCarriers, monthLong, toApprove, TODO_ICON } from "./logic";
import { HomePaused, openWeb } from "./parts";
import type { DiscrepanciesAnswer, MissingAnswer, TodoAnswer } from "./types";

/**
 * Board B6 · Home for the bookkeeper: money without call operations. What waits to be approved, carrier money that
 * is short, statements that have not arrived, what the carriers owe, and the cash that landed this month.
 *
 *   GET /api/app/accounting/steps?items=1                   Accounting › To do: the rows and the money they hold
 *   GET /api/app/carrier-files?missing=1                    the file monitor's late files (Carrier files › Missing)
 *   GET /api/app/discrepancies                              Pay issues: the total owed to the agency
 *   GET /api/app/accounting/bank?deposits=YYYY-MM&today=…   this month's deposits by week (Cash this month)
 *
 * The four tiles always show: zero is a figure, and a read that failed shows "—" in its tile. Every row opens where
 * the web does the work: matching and posting stay on the computer. The board's "· close on the 5th" is left out of
 * the subtitle: no close day is stored anywhere (accounting settings have none).
 */
export function HomeBookkeeper() {
  const { api } = useSession();
  const [today] = useState(() => dayKey(Date.now()));
  const month = today.slice(0, 7);
  const todo = useLoad(() => api<TodoAnswer>("/api/app/accounting/steps?items=1"), []);
  const missing = useLoad(() => api<MissingAnswer>("/api/app/carrier-files?missing=1").catch(() => null), []);
  const owed = useLoad(() => api<DiscrepanciesAnswer>("/api/app/discrepancies").catch(() => null), []);
  const cash = useLoad(() => api<DepositsAnswer>(depositsPath(today)).catch(() => null), []);
  const refresh = () => { todo.refresh(); missing.reload(); owed.reload(); cash.reload(); };

  const items = todo.data?.items ?? [];
  const approve = toApprove(items);
  const short = depositsShort(items);
  // A source that has not answered (or failed) is unknown, not zero.
  const late = missing.data?.available ? missing.data.missing : null;
  const payIssues = owed.data?.owed.available ? owed.data.owed : null;
  const waiting = waitingRows(items);
  const weeks = cash.data?.deposits.weeks ?? [];

  let body;
  if (!todo.data) body = todo.loading ? <Loading rows={4} /> : <Failed what="the books" message={todo.error ?? "Try again."} onRetry={todo.reload} />;
  else body = (
    <>
      <Strip>
        <Tile testID="books-approve" width={150} icon="listCheck" label="To approve" value={compactCount(approve.count)} detail={`${dollars(approve.cents)} total`} onPress={() => router.push("/money" as never)} />
        <Tile testID="books-short" width={150} label="Deposits short" value={compactCount(short.count)} detail={short.count ? <Chip tone="warn">{dollars(short.cents)}</Chip> : "None short"} onPress={() => openWeb("/app/bank", "Bank deposits")} />
        <Tile testID="books-late" width={150} label="Statements late" value={late ? compactCount(late.length) : "—"} detail={late ? (late.length ? lateCarriers(late) : "None late") : undefined} onPress={() => openWeb("/app/carrier-files?show=missing", "Missing carrier files")} />
        <MoneyStripTile testID="books-owed" label="Pay issues" cents={payIssues ? payIssues.totalCents : null} detail="Owed to you" onPress={() => openWeb("/app/discrepancies", "Pay issues")} />
      </Strip>

      <SectionHead link="To do" onLink={() => router.push("/money" as never)}>Waiting on you</SectionHead>
      <GroupBox>
        {waiting.length ? waiting.map(({ item, meta, waitsOnOthers }, i) => (
          <Row key={item.key} first={i === 0} testID={`books-todo-${item.key}`} icon={TODO_ICON[item.group]} title={item.what} meta={meta} chevron={waitsOnOthers}
            right={item.amountCents !== null ? dollars(Math.abs(item.amountCents)) : undefined} onPress={() => openWeb(item.href, item.what)} />
        )) : <Row first icon="check" iconTone="plain" title="Nothing waiting on you" meta={`${monthLong(month)}’s books have nothing to approve right now`} />}
      </GroupBox>

      <SectionHead>Cash this month</SectionHead>
      <CashCard
        totalCents={cash.data ? cash.data.deposits.totalCents : null}
        onPress={() => openWeb("/app/bank", "Bank deposits")}
        bars={weeks.length ? (
          <CashBars values={weeks.map((w) => w.cents)} labels={barLabels(weeks)} describe={weeks.map((w) => `Week of ${axisDay(w.from)}: ${dollars(w.cents)}`)} />
        ) : null}
      />
    </>
  );

  return (
    <Screen title="Today" sub={`${monthLong(month)} books`} actions={[{ icon: "search", label: "Search", onPress: () => router.push("/search") }]} onRefresh={refresh} refreshing={todo.refreshing}>
      <HomePaused />
      {body}
    </Screen>
  );
}

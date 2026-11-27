import { useEffect, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { MoneyFigure } from "@/components/book/parts";
import { PickerSheet } from "@/components/leads/parts";
import { Toast } from "@/components/leads/sheets";
import { reportMoneyWaiting } from "@/lib/counts";
import { Chip, Empty, F, Failed, Group, Header, IOS, Loading, Row, Screen, SectionHead, T } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import type { Photo } from "./device";
import { ExpenseSheet } from "./expense";
import { dayShort, localToday, monthName, monthRange, paymentChip, plural, roundCents, shiftMonth, teamDraft, todoIcon, todoOpens, wholeMoney, type TeamDraft } from "./logic";
import { Card, Change, KeyValues, Pad, Rule } from "./parts";
import { ExpenseOkSheet, PartnerPayoutsSheet, TeamPayoutsSheet } from "./sheets";
import type { Payment, PnlSummary, StepsAnswer, TeamPayoutsAnswer, TodoItem } from "./types";

/**
 * Board G3 · Money (owner, admin): what waits on them first — approve, pay — then the month: profit so far and the
 * deposits matched to what the carriers said. Reconciling and tax stay on the computer. Figures in whole dollars,
 * as drawn; each row's own screen has the cents.
 *
 *   Waiting on you  Team payouts (GET /api/app/agency/payouts, the month Team payouts lands on) and Accounting ›
 *                   To do (GET /api/app/accounting/steps?items=1), oldest first, each with its amount, each opening
 *                   its phone screen
 *   The month       Profit & loss (GET /api/app/accounting/pnl/drill?view=summary), against the month before at this
 *                   point when the server has it ("↑ $2,940 vs October at this point")
 *   Bank deposits   Bank deposits › Payments (GET /api/app/accounting/bank?payments=1)
 *
 * Each part is read on its own and gated by its own route: a part this person may not open is left out, never
 * shown empty. `asTab` draws it as the owner's tab (no back); otherwise as a stack screen. `expense` opens the new
 * expense sheet over it (board G6, after the camera of G5).
 */
type Sheet = "team" | "partners" | null;
type Read = {
  todo: TodoItem[] | null;
  team: { month: string; drafts: TeamDraft[]; recoveryPctBp: number } | null;
  pnl: PnlSummary | null;
  payments: Payment[] | null;
};

const settle = async <T,>(run: () => Promise<T>): Promise<{ ok: T } | { error: unknown }> => {
  try { return { ok: await run() }; } catch (error) { return { error }; }
};

export function MoneyTab({ asTab = true, initialSheet = null, expense = null }: {
  asTab?: boolean; initialSheet?: Sheet; expense?: { open: boolean; photo: Photo | null; onPhoto: (p: Photo) => void; onClose: () => void; onSaved: () => void } | null;
}) {
  const { api } = useSession();
  const [sheet, setSheet] = useState<Sheet>(initialSheet);
  const [okItem, setOkItem] = useState<TodoItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const today = localToday();
  const current = today.slice(0, 7);
  // Board G3's calendar: the month the profit card reads (what waits on you is always now).
  const [month, setMonth] = useState(current);
  const [picking, setPicking] = useState(false);

  const answer = useLoad<Read>(async () => {
    const teamFor = async (ym: string) => {
      const { from, to } = monthRange(ym);
      const a = await api<TeamPayoutsAnswer>(`/api/app/agency/payouts?from=${from}&to=${to}`);
      return { month: ym, drafts: teamDraft(a.preview, a.rules, a.facts), recoveryPctBp: a.rules.recoveryPctBp };
    };
    const [todo, team, pnl, payments] = await Promise.all([
      settle(() => api<StepsAnswer>("/api/app/accounting/steps?items=1").then((a) => a.items ?? [])),
      // The month Team payouts lands on: last month until everyone in it is paid, then this month.
      settle(async () => { const last = await teamFor(shiftMonth(current, -1)); return last.drafts.length ? last : teamFor(current); }),
      settle(() => api<PnlSummary>(`/api/app/accounting/pnl/drill?view=summary&kind=month&anchor=${month}`)),
      settle(() => api<{ payments: Payment[] }>("/api/app/accounting/bank?payments=1").then((a) => a.payments)),
    ]);
    // A refusal (403) only means that part is not this person's and is left out. When nothing came back at all, the
    // screen says why: a real failure first (with Try again), else the refusal.
    const errors = [todo, team, pnl, payments].flatMap((x) => ("error" in x ? [x.error] : []));
    if (errors.length === 4) throw errors.find((e) => !(e instanceof ApiError && e.status === 403)) ?? errors[0];
    return {
      todo: "ok" in todo ? todo.ok : null,
      team: "ok" in team && team.ok.drafts.length ? team.ok : null,
      pnl: "ok" in pnl ? pnl.ok : null,
      payments: "ok" in payments ? payments.ok : null,
    };
  }, [month, current]);

  const read = answer.data;
  const mine = (read?.todo ?? []).filter((i) => i.yours);
  const waiting = (read?.team ? 1 : 0) + mine.length;
  // The tab's badge is this count (board G3), once this screen has read it.
  useEffect(() => { if (read) reportMoneyWaiting(waiting); }, [read, waiting]);
  const done = (text: string) => { setSheet(null); setOkItem(null); setToast(text); answer.reload(); };

  const open = (item: TodoItem) => {
    const to = todoOpens(item);
    if (to.kind === "bill") router.push({ pathname: "/money/bills/[id]", params: { id: to.id } } as never);
    else if (to.kind === "payment") router.push({ pathname: "/money/deposits/[id]", params: { id: to.id } } as never);
    else if (to.kind === "partners") setSheet("partners");
    else if (to.kind === "expense") setOkItem(item);
    else router.push({ pathname: "/computer", params: { path: to.path, title: item.where, why: "This is worked with the statement or the records beside it." } });
  };

  // Board G3: the header's one action is the month (Snap a receipt is Menu › Add an expense, board G5).
  const header = (
    <Header title="Money" sub={month === current ? `${monthName(month)} so far` : monthName(month)} back={asTab ? undefined : IOS ? "Menu" : undefined} onBack={asTab ? undefined : router.back} large
      actions={[{ icon: "calendar", label: "Choose the month", onPress: () => setPicking(true) }]} />
  );
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(current, -i));

  const pnl = read?.pnl;
  // "vs October at this point" when the server read the month before to the same day; else the whole month before.
  const against = pnl?.previousToDate ?? null;
  return (
    <Screen header={header} onRefresh={answer.refresh} refreshing={answer.refreshing}>
      {answer.loading && !read ? <Loading rows={6} />
        : answer.errorCode?.status === 403 && !read ? <Empty icon="wallet" title="Money is for the owner and the bookkeeper" body={answer.error ?? undefined} />
          : answer.error && !read ? <Failed what="the money" message={answer.error} onRetry={answer.reload} />
            : read ? (
              <>
                {waiting ? (
                  <Group title={`Waiting on you · ${waiting}`}>
                    {read.team ? (
                      <Row testID="money-team" first icon="users" iconTone="gold" title={`Team payouts · ${monthName(read.team.month)}`}
                        meta={`${plural(read.team.drafts.length, "person", "people")} · statements ready`} right={wholeMoney(read.team.drafts.reduce((s, d) => s + d.payCents, 0))}
                        onPress={() => setSheet("team")} />
                    ) : null}
                    {mine.map((item, i) => (
                      <Row key={item.key} testID={`money-todo-${item.key}`} first={!read.team && i === 0} icon={todoIcon(item.group)} iconTone={item.group === "payouts" ? "gold" : undefined}
                        title={item.what} meta={item.detail} right={item.amountCents === null ? undefined : wholeMoney(Math.abs(item.amountCents))}
                        onPress={() => open(item)} />
                    ))}
                  </Group>
                ) : null}

                {pnl ? (
                  <>
                    <SectionHead link="Profit & loss" onLink={() => router.push({ pathname: "/money/pnl", params: { month: pnl.range.from.slice(0, 7) } } as never)}>{monthName(pnl.range.from.slice(0, 7))}</SectionHead>
                    <Pad>
                      <Card testID="money-month">
                        <KeyValues rows={[
                          ["Commission received", wholeMoney(pnl.totals.inCents)],
                          ["Lead spend", wholeMoney(pnl.totals.acquisitionCents)],
                          ["Team pay", wholeMoney(pnl.totals.splitsCents)],
                          ["Other expenses", wholeMoney(pnl.totals.overheadCents)],
                        ]} />
                        <Rule />
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                          <T kind="ink" style={{ fontFamily: F.s }}>{pnl.range.from.slice(0, 7) === current ? "Profit so far" : "Profit"}</T>
                          <MoneyFigure testID="money-profit" cents={roundCents(pnl.totals.netProfitCents)} size={26} dropZero />
                        </View>
                        <Change whole testID="money-change"
                          cents={pnl.totals.netProfitCents - (against ?? pnl.previous).netProfitCents}
                          against={`${monthName((against ?? pnl.previous).range.from.slice(0, 7))}${against ? " at this point" : ""}`} />
                      </Card>
                    </Pad>
                  </>
                ) : null}

                {read.payments?.length ? (
                  <Group title="Bank deposits">
                    {read.payments.slice(0, 4).map((p, i) => {
                      const chip = paymentChip(p, true);
                      return (
                        <Row key={p.id} testID={`money-payment-${p.id}`} first={i === 0} icon="landmark" title={p.carrierName}
                          meta={`${dayShort(p.deposits[0]?.postedOn ?? p.statementDate)} · ${p.verdict === "all_good" ? "matches statement" : `statement says ${wholeMoney(p.paidCents)}`}`}
                          chip={<Chip tone={chip.tone}>{chip.label}</Chip>} right={wholeMoney(p.landedCents)}
                          onPress={() => router.push({ pathname: "/money/deposits/[id]", params: { id: p.id } } as never)} />
                      );
                    })}
                  </Group>
                ) : null}
              </>
            ) : null}
      {read?.team ? (
        <TeamPayoutsSheet visible={sheet === "team"} month={read.team.month} drafts={read.team.drafts} recoveryPctBp={read.team.recoveryPctBp} onClose={() => setSheet(null)} onDone={done} />
      ) : null}
      <PartnerPayoutsSheet visible={sheet === "partners"} onClose={() => setSheet(null)} onDone={done} />
      <ExpenseOkSheet item={okItem} onClose={() => setOkItem(null)} onDone={done} />
      {expense ? <ExpenseSheet visible={expense.open} photo={expense.photo} onPhoto={expense.onPhoto} onClose={expense.onClose}
        onSaved={(text) => { expense.onSaved(); done(text); }} /> : null}
      <Toast text={toast} onHide={() => setToast(null)} />
      <PickerSheet title="Month" visible={picking} onClose={() => setPicking(false)} value={month}
        onPick={(m) => { setMonth(m); setPicking(false); }}
        items={months.map((m) => ({ key: m, label: `${monthName(m)} ${m.slice(0, 4)}`, icon: "calendar" as const, meta: m === current ? "This month" : undefined }))} />
    </Screen>
  );
}

import { View } from "react-native";
import { router } from "expo-router";

import { MoneyFigure } from "@/components/book/parts";
import { Chip, Empty, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { isAgencyAdvance, localToday, money, monthName, monthShort, monthYear, myPaySummary, payDay, shiftMonth } from "./logic";
import { Card, Mini, Pad } from "./parts";
import type { MyBalance, MyPay } from "./types";

/**
 * Board G7 · My balance: a producer's share in the agency's books — what they are owed, what they owe back after
 * chargebacks, and how it nets on the next pay day. One producer pay on the web (owner 2026-11-03): on an agency it
 * is My pay's ledger (GET /api/app/agency/my-pay, its reported-basis balance), which is where the web's My balance
 * sends an agency producer; where that is not switched on, the LA-7.5 balance (GET /api/app/accounting/my-balance).
 * Only the person's own figures, never what the agency grossed.
 *
 * How it adds up, as drawn: this month's share, the chargebacks owed back, and the advance from the agency (money the
 * agency paid outside a statement: repaid in full once the balance is above zero, else what is still owed of it).
 * When earlier months are still on the balance (a statement not paid yet), one more row says so, so the rows always
 * add up to the figure. The pay day is the day the agency's own paid statements agree on, else "early".
 */
type Read =
  | { source: "pay"; data: MyPay }
  | { source: "balance"; data: MyBalance };

type Adds = { balanceCents: number; shareCents: number; backCents: number; backNames: string[]; backCount: number; advanceTaken: boolean; advanceOwedCents: number };

/** The advance still owed: what the agency advanced, as far as the balance is below zero. */
function advanceOwed(balanceCents: number, advancedCents: number): number {
  return balanceCents < 0 ? Math.min(Math.abs(advancedCents), Math.abs(balanceCents)) : 0;
}

export function BalanceScreen() {
  const { api } = useSession();
  const answer = useLoad<Read>(async () => {
    try {
      return { source: "pay", data: await api<MyPay>("/api/app/agency/my-pay") };
    } catch (e) {
      // Not on an agency's producer pay (the feature is off for this plan): the LA-7.5 balance, as the web falls back.
      if (!(e instanceof ApiError) || e.status !== 403) throw e;
      return { source: "balance", data: await api<MyBalance>("/api/app/accounting/my-balance") };
    }
  }, []);
  const header = <Header title="My balance" back={IOS ? "Menu" : undefined} onBack={router.back} large />;
  const today = localToday();
  const month = today.slice(0, 7);
  const next = shiftMonth(month, 1);
  const read = answer.data;

  let body = null;
  if (read?.source === "pay") {
    const b = read.data.balances.find((x) => x.basis === "reported") ?? read.data.balances[0] ?? null;
    const s = myPaySummary(read.data, today);
    const advanced = read.data.entries.filter((e) => e.basis === "reported" && isAgencyAdvance(e.entryType)).reduce((t, e) => t + e.amountCents, 0);
    const runs = [...read.data.runs].filter((r) => r.status === "published" || r.status === "paid").sort((x, y) => y.periodStart.localeCompare(x.periodStart));
    body = !b ? <Empty icon="wallet" title="Nothing on your balance yet" body="Your share arrives with the carriers’ commission statements." /> : (
      <>
        <BalanceCard cents={b.balanceCents} payOn={payLine(payDay(read.data.runs), next)} />
        <AddsUp month={month} adds={{
          balanceCents: b.balanceCents, shareCents: s.shareCents, backCents: s.chargebacks.cents, backNames: s.chargebackNames, backCount: s.chargebacks.policies,
          advanceTaken: advanced !== 0, advanceOwedCents: advanceOwed(b.balanceCents, advanced),
        }} />
        <History runs={runs.map((r) => ({ id: r.id, month: r.periodStart.slice(0, 7), netCents: r.netCents }))} />
      </>
    );
  } else if (read?.source === "balance") {
    const d = read.data;
    if (!d.visible) body = <Empty icon="wallet" title="Not shared" body="Your agency has not turned on producer balances. Ask the owner." />;
    else {
      const mine = d.entries.filter((e) => e.occurredOn.startsWith(month));
      const sum = (es: { amountCents: number }[]) => es.reduce((t, e) => t + e.amountCents, 0);
      const backs = mine.filter((e) => e.entryType === "split_chargeback");
      body = (
        <>
          <BalanceCard cents={d.balanceCents} payOn={payLine(null, next)} />
          <AddsUp month={month} adds={{
            balanceCents: d.balanceCents, shareCents: sum(mine.filter((e) => e.entryType === "split_advance" || e.entryType === "split_earned")), backCents: sum(backs),
            backNames: [], backCount: new Set(backs.map((e) => e.policyNumber ?? e.id)).size, advanceTaken: false, advanceOwedCents: 0,
          }} />
          <History runs={d.runs.map((r) => ({ id: r.id, month: r.periodStart.slice(0, 7), netCents: r.netCents }))} opens={false} />
        </>
      );
    }
  }

  return (
    <Screen header={header} onRefresh={answer.refresh} refreshing={answer.refreshing}>
      {answer.loading && !read ? <Loading rows={4} />
        : answer.errorCode?.status === 403 && !read ? <Empty icon="wallet" title="My balance is a producer’s own page" body={answer.error ?? "Owners and bookkeepers see every producer on the computer."} />
          : answer.error && !read ? <Failed what="your balance" message={answer.error} onRetry={answer.reload} />
            : body}
    </Screen>
  );
}

/** "on 5 Dec" when the pay day is known, else "· paid in early December". */
function payLine(day: number | null, nextMonth: string): string {
  return day ? `on ${day} ${monthShort(nextMonth)}` : `· paid in early ${monthName(nextMonth)}`;
}

function AddsUp({ month, adds }: { month: string; adds: Adds }) {
  const advanceRow = adds.advanceOwedCents ? -adds.advanceOwedCents : 0;
  // Whatever the month's rows do not explain: earlier months still on the balance, less what was paid.
  const carried = adds.balanceCents - adds.shareCents - adds.backCents - advanceRow;
  return (
    <Group title="How it adds up">
      <Row testID="balance-share" first chevron={false} title={`Your share of ${monthName(month)} commission`} right={money(adds.shareCents)} />
      <Row testID="balance-chargebacks" chevron={false} title="Chargebacks you owe back" meta={adds.backNames.slice(0, 2).join(", ") || null}
        chip={adds.backCount ? <Chip tone="warn">{String(adds.backCount)}</Chip> : undefined} right={money(adds.backCents)} />
      <Row testID="balance-advance" chevron={false} title="Advance from the agency"
        meta={!adds.advanceTaken ? "None taken" : adds.advanceOwedCents ? "Still to repay" : "Repaid in full"} right={money(advanceRow)} />
      {carried !== 0 ? <Row testID="balance-carried" chevron={false} title="Carried from earlier months" meta="Less what was already paid to you" right={money(carried)} /> : null}
    </Group>
  );
}

/** The figure: owed to the producer, or what they owe the agency (the warning chip says so; colour only there). */
function BalanceCard({ cents, payOn }: { cents: number; payOn: string }) {
  const owes = cents < 0;
  return (
    <Pad>
      <Card testID="balance-card">
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <Mini>{owes ? "You owe the agency" : `Owed to you ${payOn}`}</Mini>
          {owes ? <Chip tone="warn">More came back</Chip> : null}
        </View>
        <View style={{ marginTop: 2 }}><MoneyFigure cents={Math.abs(cents)} size={38} /></View>
      </Card>
    </Pad>
  );
}

function History({ runs, opens = true }: { runs: { id: string; month: string; netCents: number }[]; opens?: boolean }) {
  if (!runs.length) return null;
  const thisYear = localToday().slice(0, 4);
  return (
    <Group title="History">
      {runs.slice(0, 12).map((r, i) => (
        <Row key={r.id} first={i === 0} icon="file" iconTone="plain" title={r.month.slice(0, 4) === thisYear ? monthName(r.month) : monthYear(r.month)} right={money(r.netCents)}
          onPress={opens ? () => router.push({ pathname: "/money/statement/[id]", params: { id: r.id } } as never) : undefined} />
      ))}
    </Group>
  );
}

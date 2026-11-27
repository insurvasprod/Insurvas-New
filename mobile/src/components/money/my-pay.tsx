import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { MoneyFigure } from "@/components/book/parts";
import { Toast } from "@/components/leads/sheets";
import { Chip, Empty, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { openStatementPdf } from "./device";
import { localToday, money, monthName, monthShort, monthYear, myPaySummary, ordinal, plural, runLine, shiftMonth } from "./logic";
import { Card, Bars, Change, Mini, Pad } from "./parts";
import type { MyPay } from "./types";

/**
 * Board G1 · My pay: a producer's own pay, never blended with the agency's money. The web's own read
 * (GET /api/app/agency/my-pay, producers only; the server answers with this person's ledger and statements and no
 * one else's). This month is what the ledger has earned so far net of what came back, on the payout basis; the bars
 * are the last six months the same way; the last three statements open line by line (G2). The agency's override is
 * named and never shown (owner rule: a producer's money is his own).
 *
 * The sub says the pay day when the agency's own paid statements agree on one ("paid on the 5th"), else "early".
 * The header's download is the newest statement's private PDF, as the web makes it. A Pay plan row appears only when
 * the ledger holds base pay, bonuses or saved deals this month, so the rows always add up to the figure.
 */
export function MyPayScreen() {
  const { api, me, refreshToken } = useSession();
  const answer = useLoad(() => api<MyPay>("/api/app/agency/my-pay"), []);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const today = localToday();
  const s = answer.data ? myPaySummary(answer.data, today) : null;
  const latest = s?.statements[0] ?? null;

  const download = async () => {
    if (!latest || busy) return;
    setBusy(true);
    try {
      const token = await refreshToken();
      if (!token) throw new Error("Sign in again to open the statement.");
      await openStatementPdf({ token, runId: latest.id, name: `statement-${latest.periodStart}-${latest.periodEnd}` });
    } catch (e) {
      setToast(e instanceof Error ? e.message : "The statement didn’t open. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const sub = s ? `${monthName(s.month)} · ${s.paidDay ? `paid on the ${ordinal(s.paidDay)}` : `paid in early ${s.paysIn}`}` : undefined;
  const header = (
    <Header title="My pay" back={IOS ? "Menu" : undefined} onBack={router.back} large sub={sub}
      actions={latest ? [{ icon: "download", label: busy ? "Opening the statement" : `Share the ${monthYear(latest.periodStart.slice(0, 7))} statement PDF`, onPress: () => void download() }] : undefined} />
  );
  const refused = answer.errorCode && answer.errorCode.status === 403;

  return (
    <Screen header={header} onRefresh={answer.refresh} refreshing={answer.refreshing}>
      {answer.loading && !s ? <Loading rows={5} />
        : refused && !s ? <Empty icon="wallet" title="My pay is a producer’s own page" body={answer.error ?? "The owner sees everyone’s pay on the computer."} />
          : answer.error && !s ? <Failed what="your pay" message={answer.error} onRetry={answer.reload} />
            : s ? (
              <>
                <Pad>
                  <Card testID="pay-expected">
                    <Mini>{`Expected for ${monthName(s.month)}`}</Mini>
                    <View style={{ marginTop: 2 }}><MoneyFigure cents={s.expectedCents} size={40} /></View>
                    <Change cents={s.deltaCents} against={monthName(shiftMonth(s.month, -1))} testID="pay-change" />
                    <View style={{ marginTop: 12 }}><Bars testID="pay-bars" values={s.bars.map((b) => b.cents)} labels={s.bars.map((b) => b.label)} /></View>
                  </Card>
                </Pad>
                <Group title="This month">
                  <Row first icon="trend" title="Advances" meta={plural(s.advances.policies, "policy issued", "policies issued")} right={money(s.advances.cents)} chevron={false} />
                  <Row testID="pay-earned" icon="receipt" title="As earned" meta={s.earnedMeta} right={money(s.earned.cents)} chevron={false} />
                  {s.plan.count ? <Row icon="wallet" title="Pay plan" meta="Base pay, bonuses and saved deals" right={money(s.plan.cents)} chevron={false} /> : null}
                  <Row testID="pay-chargebacks" icon="undo" iconTone={s.chargebacks.cents ? "warn" : undefined} title="Chargebacks" meta={s.chargebackMeta}
                    chip={s.chargebacks.policies ? <Chip tone="warn">{`${s.chargebacks.policies} lapsed`}</Chip> : undefined}
                    right={money(s.chargebacks.cents)} chevron={false} />
                  <Row icon="wallet" title="Agency override" meta={`Kept by ${me?.tenant.name ?? "the agency"}`} right="Not shown" chevron={false} />
                </Group>
                <Group title="Statements">
                  {s.statements.length ? s.statements.slice(0, 3).map((r, i) => (
                    <Row key={r.id} testID={`pay-statement-${r.id}`} first={i === 0} icon="file" iconTone="plain" title={monthYear(r.periodStart.slice(0, 7))} meta={runLine(r)} right={money(r.netCents)}
                      onPress={() => router.push({ pathname: "/money/statement/[id]", params: { id: r.id } } as never)} />
                  )) : <Row first icon="file" iconTone="plain" title="No statements yet" meta={`${monthShort(s.month)} is paid ${s.paidDay ? `on the ${ordinal(s.paidDay)} of ${s.paysIn}` : `in early ${s.paysIn}`}`} chevron={false} />}
                </Group>
              </>
            ) : null}
      <Toast text={toast} onHide={() => setToast(null)} />
    </Screen>
  );
}

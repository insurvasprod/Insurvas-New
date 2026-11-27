import { useState } from "react";
import { router } from "expo-router";

import { FigureTile, MoneyFigure, TilePair } from "@/components/book/parts";
import { Toast } from "@/components/leads/sheets";
import { Chip, Empty, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { displayName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { openStatementPdf } from "./device";
import { dayShort, methodLabel, money, monthYear, plural, statementCounts, statementGroups } from "./logic";
import { Pad } from "./parts";
import type { StatementAnswer, StatementLine } from "./types";

/**
 * Board G2 · Pay statement: one month line by line, one line per policy, plain figures, colour only in the chip.
 * The web's own statement (GET /api/app/agency/statements/<run>; a producer opens only his own, the owner and the
 * bookkeeper any), built from the ledger at request time so it always reconciles. The download in the bar is the
 * same private PDF the web makes, opened in the phone's viewer (which shares it).
 *
 * Each line's second line is the carrier and what it was ("Mutual of Omaha · 9 mo advance", "Transamerica · lapsed in
 * month 4"), from the route's `lineFacts`; As earned is one summary row ("Renewals · 31 policies"), as drawn. Base pay
 * and adjustments show only when the month has them, so the lines always add up to what was paid.
 */
const SHOWN = 3;

/** What went to the producer: the period's payouts when it was paid, else what its lines add up to. */
function paidCents(s: StatementAnswer["statement"]): number {
  if (s.payouts.length) return Math.abs(s.payouts.reduce((sum, p) => sum + p.amountCents, 0));
  return s.lines.reduce((sum, l) => sum + l.netCents, 0) + s.adjustments.reduce((sum, a) => sum + a.amountCents, 0);
}

/** "Mutual of Omaha · 9 mo advance" / "Transamerica · lapsed in month 4": the carrier and what the line was. */
export function lineMeta(l: StatementLine, fact: { advanceMonths: number | null; policyMonth: number | null } | undefined, back: boolean): string {
  const carrier = l.carrier !== "—" ? l.carrier : null;
  const what = back
    ? fact?.policyMonth ? `lapsed in month ${fact.policyMonth}` : "came back"
    : /advance/i.test(l.label) ? fact?.advanceMonths ? `${fact.advanceMonths} mo advance` : "advance"
      : l.client === "—" ? null : l.label;
  return [carrier, what].filter(Boolean).join(" · ");
}

export function StatementScreen({ runId }: { runId: string }) {
  const { api, refreshToken } = useSession();
  const answer = useLoad(() => api<StatementAnswer>(`/api/app/agency/statements/${encodeURIComponent(runId)}`), [runId]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const data = answer.data;
  const title = data ? monthYear(data.run.periodStart.slice(0, 7)) : "Statement";

  const download = async () => {
    if (!data || busy) return;
    setBusy(true);
    try {
      const token = await refreshToken();
      if (!token) throw new Error("Sign in again to open the statement.");
      await openStatementPdf({ token, runId, name: `statement-${data.run.periodStart}-${data.run.periodEnd}` });
    } catch (e) {
      setToast(e instanceof Error ? e.message : "The statement didn’t open. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <Header title={title} back={IOS ? "My pay" : undefined} onBack={router.back} large={false}
      actions={data ? [{ icon: "download", label: busy ? "Opening the statement" : "Share the statement PDF", onPress: () => void download() }] : undefined} />
  );
  const counts = data ? statementCounts(data.statement.lines) : null;
  const paidLine = data ? (data.run.paidOn ? [`${dayShort(data.run.paidOn)}`, methodLabel(data.run.method)].filter(Boolean).join(" · ") : "Published, not paid yet") : null;
  const lineRow = (l: StatementLine, i: number) => {
    const back = l.netCents < 0 && l.chargebackCents !== null;
    return (
      <Row key={l.id} testID={`statement-line-${l.id}`} first={i === 0} chevron={false}
        title={l.client === "—" ? l.label : displayName(l.client)}
        meta={lineMeta(l, data?.lineFacts?.[l.id], back)}
        chip={back ? <Chip tone="bad">Charged back</Chip> : undefined}
        right={money(l.netCents)} />
    );
  };

  return (
    <Screen header={header} onRefresh={answer.refresh} refreshing={answer.refreshing}>
      {answer.loading && !data ? <Loading rows={5} />
        : answer.error && !data ? <Failed what="the statement" message={answer.error} onRetry={answer.reload} />
          : data && counts ? (
            <>
              <Pad>
                <TilePair>
                  <FigureTile testID="statement-paid" label={data.run.status === "paid" ? "Paid" : "To be paid"} detail={paidLine}>
                    <MoneyFigure cents={paidCents(data.statement)} />
                  </FigureTile>
                  <FigureTile testID="statement-policies" label="Policies" detail={counts.chargedBack ? `${plural(counts.chargedBack, "charged back", "charged back")}` : "None charged back"}>
                    {String(counts.policies)}
                  </FigureTile>
                </TilePair>
              </Pad>
              {data.statement.lines.length ? statementGroups(data.statement.lines).map((g) => {
                if (g.key === "earned") {
                  const policies = new Set(g.lines.map((l) => l.policy).filter((p) => p && p !== "—")).size;
                  return (
                    <Group key={g.key} title={g.title}>
                      <Row testID="statement-earned" first chevron={false} title="Renewals" meta={plural(policies || g.lines.length, "policy", "policies")} right={money(g.totalCents)} />
                    </Group>
                  );
                }
                const all = open[g.key] || g.lines.length <= SHOWN + 1;
                const shown = all ? g.lines : g.lines.slice(0, SHOWN);
                const rest = g.lines.slice(SHOWN);
                return (
                  <Group key={g.key} title={g.title}>
                    {shown.map(lineRow)}
                    {!all ? (
                      <Row testID={`statement-more-${g.key}`} title={`+ ${rest.length} more`} right={money(rest.reduce((s, l) => s + l.netCents, 0))} chevron
                        onPress={() => setOpen((o) => ({ ...o, [g.key]: true }))} />
                    ) : null}
                  </Group>
                );
              }) : <Empty icon="file" title="No lines this month" body="Nothing was earned or came back in this period." />}
              {data.statement.adjustments.length ? (
                <Group title="Adjustments">
                  {data.statement.adjustments.map((a, i) => <Row key={a.id} first={i === 0} chevron={false} title={a.reason || "Adjustment"} right={money(a.amountCents)} />)}
                </Group>
              ) : null}
            </>
          ) : null}
      <Toast text={toast} onHide={() => setToast(null)} />
    </Screen>
  );
}

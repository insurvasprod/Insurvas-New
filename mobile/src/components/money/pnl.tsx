import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { MoneyFigure } from "@/components/book/parts";
import { SegControl, Sheet } from "@/components/leads/sheets";
import { Empty, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { dayShort, drillPath, money, monthName, monthShort, pnlCategories, roundCents, spent, wholeMoney, type PnlCategory } from "./logic";
import { Card, Bars, Change, Mini, Pad } from "./parts";
import type { DrillAnswer, PnlSummary } from "./types";

/**
 * Board G3e · Profit & loss: did this period make money — the month against the last six, and where it went. The
 * web's own statement (GET /api/app/accounting/pnl/drill?view=summary, Profit & loss's loadPnl, the agency's basis).
 * Month · Quarter · Year as the web's period kinds. "Where it went" rolls the statement's cost lines up into the
 * board's categories (Leads · N vendors, Team pay · N people, Dialer and phone lines, Office and equipment, Software;
 * any other category keeps its own name); a category opens its entries (the same drill the web's lines open). The
 * accountant's tax summaries stay on the computer. `month` ("2026-10") is the month Money's calendar chose: the period
 * holding it is read (the server's `anchor`), else the one holding today.
 */
type Kind = "month" | "quarter" | "year";
const KINDS: { key: Kind; label: string }[] = [{ key: "month", label: "Month" }, { key: "quarter", label: "Quarter" }, { key: "year", label: "Year" }];

export function PnlScreen({ month = null }: { month?: string | null }) {
  const { api } = useSession();
  const [kind, setKind] = useState<Kind>("month");
  const [cat, setCat] = useState<PnlCategory | null>(null);
  const anchor = month && /^\d{4}-\d{2}$/.test(month) ? month : null;
  const answer = useLoad(() => api<PnlSummary>(`/api/app/accounting/pnl/drill?view=summary&kind=${kind}${anchor ? `&anchor=${anchor}` : ""}`), [kind, anchor]);
  const s = answer.data;
  // "So far" only while the period holds today (its last day included); a finished period is its whole figure.
  const current = s ? s.range.from <= s.today && s.today <= s.range.to : false;
  const header = (
    <Header title="Profit & loss" back={IOS ? "Money" : undefined} onBack={router.back} large
      belowFull={<View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><SegControl items={KINDS} value={kind} onChange={(k) => setKind(k as Kind)} /></View>} />
  );
  const cats = s ? pnlCategories(s.lines, s.splitPeople) : [];
  const trend = s?.trend.slice(-6) ?? [];
  // "vs October at this point" for the month that holds today (the server's month before to the same day).
  const against = s?.previousToDate ?? null;
  const label = s ? (s.kind === "month" ? monthName(s.range.from.slice(0, 7)) : s.range.label) : "";

  return (
    <Screen header={header} onRefresh={answer.refresh} refreshing={answer.refreshing}>
      {answer.loading && !s ? <Loading rows={5} />
        : answer.error && !s ? <Failed what="the profit and loss" message={answer.error} onRetry={answer.reload} />
          : s ? (
            <>
              <Pad>
                <Card testID="pnl-card">
                  <Mini>{`${label}${current ? " so far" : ""}`}</Mini>
                  <MoneyFigure testID="pnl-net" cents={roundCents(s.totals.netProfitCents)} size={36} dropZero />
                  <Change whole testID="pnl-change" cents={s.totals.netProfitCents - (against ?? s.previous).netProfitCents}
                    against={against ? `${monthName(against.range.from.slice(0, 7))} at this point` : s.kind === "month" ? monthName(s.previous.range.from.slice(0, 7)) : s.previous.range.label} />
                  {trend.length ? (
                    <View style={{ marginTop: 10 }}>
                      <Bars testID="pnl-bars" height={100} values={trend.map((t) => Math.max(0, t.netCents))} labels={trend.map((t) => monthShort(t.month))} />
                    </View>
                  ) : null}
                </Card>
              </Pad>
              <Group title="Where it went">
                {cats.length ? cats.map((c, i) => (
                  <Row key={c.key} testID={`pnl-cat-${c.key}`} first={i === 0} icon={c.icon} title={c.title} meta={c.meta}
                    right={c.cents < 0 ? spent(c.cents) : wholeMoney(c.cents)} onPress={() => setCat(c)} />
                )) : <Row first icon="check" title="No costs booked" meta="Bills, expenses and payouts land here once booked" chevron={false} />}
              </Group>
            </>
          ) : null}
      <DrillSheet cat={cat} period={s ? { kind, anchor: s.range.from.slice(0, 7), basis: s.basis } : null} onClose={() => setCat(null)} />
    </Screen>
  );
}

/** One category's entries, every line's drill read together, newest first; each names its source. */
function DrillSheet({ cat, period, onClose }: { cat: PnlCategory | null; period: { kind: string; anchor: string; basis: string } | null; onClose: () => void }) {
  const { api } = useSession();
  const answer = useLoad(async () => {
    if (!cat || !period) return null;
    const all = await Promise.all(cat.lines.map((l) => api<DrillAnswer>(drillPath(l, period))));
    return all.flatMap((a) => a.rows).sort((a, b) => (b.incurredOn ?? "").localeCompare(a.incurredOn ?? ""));
  }, [cat, period?.kind, period?.anchor]);
  const rows = answer.data ?? [];
  return (
    <Sheet visible={Boolean(cat)} title={cat?.title ?? ""} onClose={onClose} testID="pnl-drill">
      {answer.loading ? <Loading rows={3} />
        : answer.error ? <Empty icon="refresh" tone="bad" title="We couldn’t load the entries" body={answer.error} />
          : !rows.length ? <Empty icon="receipt" title="No entries" body="Nothing was booked here in the period." />
            : (
              <View style={{ marginHorizontal: -16 }}>
                {rows.slice(0, 50).map((r, i) => (
                  <Row key={r.entryId ?? i} first={i === 0} chevron={false} title={r.source?.label ?? r.description ?? "Entry"} meta={r.incurredOn ? dayShort(r.incurredOn) : null} right={money(r.amountCents)} />
                ))}
              </View>
            )}
    </Sheet>
  );
}

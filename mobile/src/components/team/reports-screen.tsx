import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { PickerSheet } from "@/components/leads/parts";
import { Card, Group, Header, Row, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { activityWindow, change, comparisonName, cumulative, per100, periodName, periodOf, persistencyCard, previousPeriod, rateText, type PeriodKey } from "./logic";
import { ChangeLine, MiniLine, ReportCard, openTeam } from "./parts";
import { loadRetentionCard } from "./report-screens";
import type { ActivityWeeks, PersistencyAnswer, QualityAnswer, SalesReport } from "./types";

const PERIODS: { key: PeriodKey; label: string }[] = [{ key: "month", label: "This month" }, { key: "quarter", label: "This quarter" }, { key: "year", label: "This year" }];

/**
 * Board I3 · Reports: the reports that read well on a phone, each a card with its one number and a sparkline (owner
 * pick: switch + sparkline cards, no donuts) — Sales performance, Team activity, Book scorecards, Retention
 * scorecard, Partner quality. Each card reads its report's own route and is left out when that route refuses this
 * person (the web's role and plan gates), so nobody sees a card they cannot open. The calendar picks the period the
 * sales and partner cards count (this month, quarter or year). The table-heavy reports open on the computer.
 *
 * Team activity shows dials: talk time is not recorded anywhere yet (no phone provider). The retention card has no
 * sparkline: its route answers this month's counts, not a series (its figure is saved of worked, as I4c counts worked).
 * Book scorecards opens the computer: the phone has no persistency screen. "Sold" on the partner card is a submitted
 * application — what a partner is paid for under the agency's deal (Model A, per submitted application).
 */
export function ReportsScreen({ back = "Menu" }: { back?: string }) {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [picking, setPicking] = useState(false);
  const header = <Header title="Reports" back={back} onBack={() => router.back()} large actions={[{ icon: "calendar", label: `Period: ${PERIODS.find((x) => x.key === period)?.label}`, onPress: () => setPicking(true) }]} />;
  return (
    <Screen header={header}>
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <SalesCard period={period} />
        <ActivityCard />
        <BookCard />
        <RetentionCard />
        <PartnerCard period={period} />
      </View>
      <Group title="On the computer">
        <Row first icon="laptop" iconTone="plain" title="True CPA, Lead sources, Queue scoring, Hierarchy"
          onPress={() => openTeam(`/computer?path=${encodeURIComponent("/app/true-cpa")}&title=${encodeURIComponent("Reports")}`)} />
      </Group>
      <PickerSheet title="Period" visible={picking} onClose={() => setPicking(false)} value={period}
        onPick={(k) => { setPeriod(k as PeriodKey); setPicking(false); }} items={PERIODS.map((x) => ({ key: x.key, label: x.label, icon: "calendar" as const }))} />
    </Screen>
  );
}

/** While a card's report is on its way, its frame holds the place; a refused or failed report draws nothing. */
function Waiting() {
  return <Card style={{ height: 112 }}><View /></Card>;
}

const thisWord = (k: PeriodKey) => (k === "month" ? "this month" : k === "quarter" ? "this quarter" : "this year");

function SalesCard({ period }: { period: PeriodKey }) {
  const { api } = useSession();
  const now = periodOf(period);
  const was = previousPeriod(period);
  const load = useLoad(async () => {
    const [a, b] = await Promise.all([
      api<{ report: SalesReport }>(`/api/app/reports/sales?from=${now.from}&to=${now.to}`),
      api<{ report: SalesReport }>(`/api/app/reports/sales?from=${was.from}&to=${was.to}`).catch(() => null),
    ]);
    return { a: a.report, b: b?.report ?? null };
  }, [now.from, now.to]);
  if (!load.data) return load.loading ? <Waiting /> : null;
  const { a, b } = load.data;
  const c = change(a.totals.submitted, b?.totals.submitted ?? 0);
  return (
    <ReportCard testID="report-sales" title="Sales performance" label={`Applications ${thisWord(period)}`} value={a.totals.submitted.toLocaleString()}
      change={b ? <ChangeLine arrow={c.arrow} value={c.text} against={comparisonName(period)} /> : undefined}
      spark={cumulative(a.trend.buckets.map((x) => x.submitted))} onPress={() => openTeam("/reports/sales")} />
  );
}

function ActivityCard() {
  const { api } = useSession();
  // Eight weeks to now: the last is this week so far, the one before it the comparison.
  const w = activityWindow("week");
  const from = new Date(Date.parse(w.from) - 7 * 7 * 86_400_000).toISOString();
  const load = useLoad(() => api<ActivityWeeks>(`/api/app/activity?series=weeks&from=${encodeURIComponent(from)}&to=${encodeURIComponent(w.to)}`), [from.slice(0, 10)]);
  if (!load.data) return load.loading ? <Waiting /> : null;
  const weeks = load.data.weeks;
  const thisWeek = weeks[weeks.length - 1]?.dials ?? 0;
  const lastWeek = weeks[weeks.length - 2]?.dials ?? 0;
  const c = change(thisWeek, lastWeek);
  return (
    <ReportCard testID="report-activity" title="Team activity" label="Dials this week" value={thisWeek.toLocaleString()}
      change={weeks.length > 1 ? <ChangeLine arrow={c.arrow} value={c.text} against="last week" /> : undefined}
      spark={weeks.map((x) => x.dials)} onPress={() => openTeam("/reports/activity")} />
  );
}

/** Book scorecards (GET /api/app/persistency): 13-month persistency, each issue quarter's as the sparkline. */
function BookCard() {
  const { api } = useSession();
  const load = useLoad(() => api<PersistencyAnswer>("/api/app/persistency"), []);
  if (!load.data) return load.loading ? <Waiting /> : null;
  const card = persistencyCard(load.data.report);
  const value = card.rate === null ? "—" : `${Math.round(card.rate * 100)}%`;
  return (
    <ReportCard testID="report-book" title="Book scorecards" label="13-month persistency" value={value}
      change={card.rate === null ? <MiniLine>No policy is 13 months old yet</MiniLine>
        : card.change ? <ChangeLine arrow={card.change.arrow} value={`${card.change.text} pts`} against="last quarter" /> : <MiniLine>{`Of ${card.eligible} policies 13 months old`}</MiniLine>}
      spark={card.quarters} onPress={() => openTeam(`/computer?path=${encodeURIComponent("/app/persistency")}&title=${encodeURIComponent("Book scorecards")}`)} />
  );
}

function RetentionCard() {
  const { api } = useSession();
  const load = useLoad(() => loadRetentionCard(api), []);
  if (!load.data) return load.loading ? <Waiting /> : null;
  if (!load.data.available) return null;
  const t = load.data.total;
  // "23 of 41": saved of the cases worked, the same Worked as the scorecard's own tile (I4c: open, saved, lost and
  // closed without a save), so the card and the report never disagree.
  const worked = t.open + t.saved + t.lost + t.closedNoSave;
  return (
    <ReportCard testID="report-retention" title="Retention scorecard" label={load.data.month ? "Saved this month" : "Saved, last 90 days"} value={`${t.saved} of ${worked}`}
      change={<MiniLine>{t.saved + t.lost === 0 ? "Nothing decided yet" : t.rate === null ? "Too few decided for a rate" : `${rateText(t)} save rate`}</MiniLine>}
      onPress={() => openTeam("/reports/retention")} />
  );
}

function PartnerCard({ period }: { period: PeriodKey }) {
  const { api } = useSession();
  const now = periodOf(period);
  const load = useLoad(() => api<QualityAnswer>(`/api/app/partner-quality?from=${now.from}&to=${now.to}`), [now.from, now.to]);
  if (!load.data) return load.loading ? <Waiting /> : null;
  const { summary, previous_summary: prev, weeks } = load.data;
  const nowRate = per100(summary.submitted, summary.sent);
  const prevRate = per100(prev.submitted, prev.sent);
  const c = change(nowRate ?? 0, prevRate ?? 0, 1);
  return (
    <ReportCard testID="report-partners" title="Partner quality" label={period === "month" ? "Sold per 100 leads, all partners" : `Sold per 100 leads, all partners · ${periodName(period)}`} value={nowRate === null ? "—" : nowRate.toFixed(1)}
      change={nowRate !== null && prevRate !== null ? <ChangeLine arrow={c.arrow} value={c.text} against={comparisonName(period)} /> : undefined}
      spark={weeks.map((x) => per100(x.submitted, x.sent) ?? 0)} onPress={() => openTeam("/reports/partners")} />
  );
}

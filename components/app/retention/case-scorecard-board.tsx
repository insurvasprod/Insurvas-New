"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { ReportsSlot, useUrlTab } from "@/components/app/reports/reports-slot";
import { STEP_LABELS, type Step } from "@/lib/retention/cases/ladder";
import { MIN_DECIDED, rateText, type ScoreLine } from "@/lib/retention/cases/scorecard";
import { SCORECARD_PERIOD_LABELS, SCORECARD_PERIODS, type ScorecardPeriod } from "@/lib/retention/scorecard";

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/**
 * Reports › Retention scorecard on the ladder (owner 2026-11-05; docs/retention/SPEC.md). Per person, and per
 * step: open, saved (a carrier file proved it), lost, closed without a save, unreachable, the save rate (saved ÷
 * saved + lost, counts under 10 decided) and the premium kept. The tabs sit on the title line (`?tab=`).
 */
export function CaseScorecardBoard({ people, steps, total, names, period }: { people: ScoreLine[]; steps: ScoreLine[]; total: ScoreLine; names: Record<string, string>; period: ScorecardPeriod }) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, startRefresh] = useTransition();
  const { tab, setTab, href } = useUrlTab(["people", "steps"] as const, "people");
  const toolbar = (
    <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
      <select aria-label="Period" className={toolbarControl} value={period} onChange={(e) => router.push(e.target.value === "180" ? pathname : `${pathname}?period=${e.target.value}`)}>
        {(Object.keys(SCORECARD_PERIODS) as ScorecardPeriod[]).map((p) => <option key={p} value={p}>{SCORECARD_PERIOD_LABELS[p]}</option>)}
      </select>
    </DataToolbar>
  );
  const row = (l: ScoreLine, label: string, strong = false) => (
    <tr key={l.key} className={strong ? "font-semibold" : undefined}>
      <td className="text-foreground">{label}</td>
      <td className="text-right tabular-nums">{l.open.toLocaleString("en-US")}</td>
      <td className="text-right tabular-nums">{l.saved.toLocaleString("en-US")}</td>
      <td className="text-right tabular-nums">{l.lost.toLocaleString("en-US")}</td>
      <td className="text-right tabular-nums">{l.closedNoSave.toLocaleString("en-US")}</td>
      <td className="text-right tabular-nums">{l.unreachable.toLocaleString("en-US")}</td>
      <td className="text-right tabular-nums">{rateText(l)}</td>
      <td className="text-right tabular-nums">{money(l.keptCents)}/mo</td>
    </tr>
  );
  const head = (first: string) => (
    <thead>
      <tr>
        <th>{first}</th>
        <th className="text-right">Open</th>
        <th className="text-right">Saved</th>
        <th className="text-right">Lost</th>
        <th className="text-right">Closed, no save</th>
        <th className="text-right">Unreachable</th>
        <th className="text-right" title={`Saved of saved and lost; under ${MIN_DECIDED} decided cases the counts are shown.`}>Save rate</th>
        <th className="text-right">Premium kept</th>
      </tr>
    </thead>
  );

  return (
    <>
      <ReportsSlot slot="lead"><ViewTabs label="Retention scorecard views" value={tab} onChange={setTab} tabs={[{ key: "people", label: "By person", count: people.length }, { key: "steps", label: "By step" }]} /></ReportsSlot>
      <StatStrip label="Retention, on the ladder">
        <StatTile label="Open" href="/app/retention" value={total.open.toLocaleString("en-US")} footnote={`${total.unreachable} unreachable`} />
        <StatTile label="Saved" href={href("steps")} value={total.saved.toLocaleString("en-US")} valueTone={total.saved ? "good" : undefined} footnote={`${money(total.keptCents)}/mo kept`} />
        <StatTile label="Lost" href={href("steps")} value={total.lost.toLocaleString("en-US")} footnote={`${total.closedNoSave} closed without a save`} />
        <StatTile label="Retention rate" href={href("people")} value={rateText(total)} labelTitle={`Saved of saved and lost. Under ${MIN_DECIDED} decided cases the counts are shown.`} footnote="saved ÷ saved + lost" />
      </StatStrip>
      <TableCard toolbar={toolbar} footer={<span>Saved means a carrier file proved it; closed without a save counts apart from the rate</span>}>
        {total.open + total.saved + total.lost + total.closedNoSave === 0 ? (
          <EmptyState title="No cases in this period" hint="Cases come from the carrier files; they show here as they are worked and closed." />
        ) : tab === "steps" ? (
          <table className="portal-lead-table w-full text-left text-sm">
            {head("Step")}
            <tbody>
              {steps.map((l) => row(l, STEP_LABELS[l.key as Step] ?? l.key))}
              {row(total, "All steps", true)}
            </tbody>
          </table>
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            {head("Person")}
            <tbody>
              {people.map((l) => row(l, l.key === "nobody" ? "Nobody yet" : names[l.key] ?? "Someone no longer here"))}
              {people.length > 1 && row(total, "Everyone", true)}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}

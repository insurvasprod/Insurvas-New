"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { useUrlTab } from "@/components/app/reports/reports-slot";
import { FallbackPeopleChart, FallbackReasonChart } from "@/components/app/retention/retention-charts";
import { showHref, type ShowMode } from "@/lib/reports/show";
import { reportPeriod } from "@/lib/reports/periodText";
import { MIN_SAVE_SAMPLE, rateText, SAVE_REASON_LABELS, SAVED_AFTER_DAYS, SCORECARD_PERIOD_LABELS, SCORECARD_PERIODS, type ReasonLine, type ScorecardPeriod } from "@/lib/retention/scorecard";
import type { Scorecard } from "@/lib/retention/scorecardStore";

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

/**
 * LA-5.8 (Notion sprint) · the retention scorecard. The save rate exists only in the by-reason table,
 * whose last row is the blended figure — never shown on its own. Under ten decided cases a reason shows
 * "3 of 5 saved", not a percentage. Unreachable cases have their own column and stay out of the rate.
 *
 * Foundation pass (2026-11-03, docs/reports/FOUNDATION-PASS.md): the person's reasons and the owner's
 * list of people were two tables stacked under the strip; they are the view's tabs on the title line
 * (`?tab=reasons|people`), and a person in the list opens their reasons.
 *
 * Round 7 (owner pick 0·A/5·A, 2026-11-10): on the Retention rail, in the same frame as the ladder's scorecard;
 * the page draws Everyone · a person's save rate on the title line as link tabs, and this board follows `?tab=`.
 *
 * Table · Chart (owner 2026-11-12: the switch on every Reports sub-page; the page puts it on the title line, opening on
 * the chart as the ladder's scorecard does): `show` swaps each tab's table for its chart (retention-charts.tsx), the
 * strips staying. Everyone is a bar a person, cases worked with the saved inside; a person's reasons are a bar a
 * reason. Counts only: the save rate stays in the by-reason table.
 */
export function RetentionScorecardBoard({ data, period, selected, isOwner, viewerId, show = "chart" }: { data: Scorecard; period: ScorecardPeriod; selected: string | null; isOwner: boolean; viewerId: string; show?: ShowMode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, startRefresh] = useTransition();
  const go = (next: { period?: string; rep?: string | null }) => {
    const params = new URLSearchParams();
    const p = next.period ?? period;
    if (p !== "180") params.set("period", p);
    const r = next.rep === undefined ? selected : next.rep;
    if (r) params.set("rep", r);
    if (show !== "chart") params.set("show", show);
    router.push(params.size ? `${pathname}?${params}` : pathname);
  };
  const card = data.cards.find((c) => c.userId === (selected ?? (isOwner ? data.cards[0]?.userId : viewerId))) ?? null;
  const team = isOwner && data.cards.length > 1;
  // ScA (owner pick 2026-11-05): an owner with a team lands on everyone, one row per person, and a name opens
  // that person's reasons; anyone else lands on their own reasons.
  const { tab } = useUrlTab(["people", "reasons"] as const, team ? (selected ? "reasons" : "people") : "reasons");
  const shown = team ? tab : "reasons";
  const sum = (pick: (c: Scorecard["cards"][number]) => number) => data.cards.reduce((total, c) => total + pick(c), 0);
  const teamReached = sum((c) => c.reached);
  const teamAttempts = sum((c) => c.attempts);
  const repHref = (rep: string) => { const params = new URLSearchParams(); if (period !== "180") params.set("period", period); params.set("rep", rep); params.set("tab", "reasons"); return `${pathname}?${params}`; };
  // The chart's rows open the table under them (`?show=table`), every other param kept.
  const tableOf = (href: string) => showHref(href, "table");
  const here = () => { const params = new URLSearchParams(); if (period !== "180") params.set("period", period); if (selected) params.set("rep", selected); params.set("tab", shown); return `${pathname}?${params}`; };
  const periodLabel = reportPeriod(data.from, data.to);
  const span = <>{reportPeriod(data.from, data.to)}{data.holdoutExcluded ? ` · ${data.holdoutExcluded.toLocaleString("en-US")} held-out ${data.holdoutExcluded === 1 ? "policy" : "policies"} left out` : ""}</>;
  const toolbar = (
    <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
      <select aria-label="Period" className={toolbarControl} value={period} onChange={(e) => go({ period: e.target.value })}>
        {(Object.keys(SCORECARD_PERIODS) as ScorecardPeriod[]).map((p) => <option key={p} value={p}>{SCORECARD_PERIOD_LABELS[p]}</option>)}
      </select>
      {team && shown === "reasons" && (
        <select aria-label="Person" className={toolbarControl} value={card?.userId ?? ""} onChange={(e) => go({ rep: e.target.value })}>
          {data.cards.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
        </select>
      )}
    </DataToolbar>
  );

  if (!data.cards.length) {
    return (
      <TableCard toolbar={toolbar} footer={<span>{span}</span>}>
        <EmptyState title="Nothing worked in this period" hint="Calls logged on the Save queue and the paper-bill campaign, and reinstatements the carrier confirmed, show here." />
      </TableCard>
    );
  }

  return (
    <>
      {shown === "people" && (
        <StatStrip label="The team's retention">
          <StatTile label="Policies worked" value={sum((c) => c.policiesWorked).toLocaleString("en-US")} footnote={`${teamAttempts.toLocaleString("en-US")} calls`} />
          <StatTile label="Contact rate" value={pct(teamAttempts ? teamReached / teamAttempts : null)} footnote={`${teamReached.toLocaleString("en-US")} reached a person`} />
          <StatTile label="Conversions" value={sum((c) => c.conversions).toLocaleString("en-US")} footnote="paper bill → bank, verified" />
          <StatTile label="Reinstatements" value={sum((c) => c.reinstatements).toLocaleString("en-US")} footnote="confirmed by a carrier file" />
          <StatTile label="Premium protected" value={money(sum((c) => c.premiumProtectedCents))} labelTitle={`Annual premium of the policies still in force ${SAVED_AFTER_DAYS} days after being worked.`} footnote={`advance protected ${money(sum((c) => c.advanceProtectedCents))}`} />
        </StatStrip>
      )}
      {card && shown === "reasons" && (
        <StatStrip label={`${card.name}'s retention`}>
          <StatTile label="Policies worked" value={card.policiesWorked.toLocaleString("en-US")} footnote={`${card.attempts.toLocaleString("en-US")} calls`} />
          <StatTile label="Contact rate" value={pct(card.contactRate)} labelTitle="Calls that reached a person, of all calls. Voicemails and wrong numbers are a data problem, not a failure: they are kept out of the save rate." footnote={`${card.reached.toLocaleString("en-US")} reached a person`} />
          <StatTile label="Conversions" value={card.conversions.toLocaleString("en-US")} labelTitle="Paper bill switched to bank draft, counted once a carrier file proved it." footnote="paper bill → bank, verified" />
          <StatTile label="Reinstatements" value={card.reinstatements.toLocaleString("en-US")} footnote="confirmed by a carrier file" />
          <StatTile label="Premium protected" value={money(card.premiumProtectedCents)} labelTitle={`Annual premium of the policies still in force ${SAVED_AFTER_DAYS} days after being worked.`} footnote={`advance protected ${money(card.advanceProtectedCents)}`} />
        </StatStrip>
      )}

      {show === "chart" && shown === "reasons" && card && (
        <FallbackReasonChart toolbar={toolbar} name={card.name} lines={card.byReason} blended={card.blended} labels={SAVE_REASON_LABELS} periodLabel={periodLabel} tableHref={tableOf(repHref(card.userId))} />
      )}

      {show === "chart" && shown === "people" && (
        <FallbackPeopleChart toolbar={toolbar} cards={data.cards} periodLabel={periodLabel} personHref={(userId) => tableOf(repHref(userId))} tableHref={tableOf(here())} />
      )}

      {/* The table view: the markup LA-5.8 pins (lib/retention/*.test.mjs), as it was. */}
      {show === "table" && <>
      {shown === "reasons" && (
        <TableCard toolbar={toolbar} footer={<span>{span}</span>}>
          {card ? <ReasonTable lines={card.byReason} blended={card.blended} /> : null}
        </TableCard>
      )}

      {shown === "people" && (
        <TableCard toolbar={toolbar} footer={<span>{span}</span>}>
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Person</th>
                <th className="text-right">Worked</th>
                <th className="text-right">Contact rate</th>
                <th className="text-right">Saved</th>
                <th className="text-right">Lost</th>
                <th className="text-right">Unreachable</th>
                <th className="text-right">Too soon</th>
                <th className="text-right">Conversions</th>
                <th className="text-right">Premium protected</th>
              </tr>
            </thead>
            <tbody>
              {/* Counts, never a blended save rate: that lives only in a person's by-reason table (LA-5.8). */}
              {data.cards.map((c) => (
                <tr key={c.userId}>
                  <td className="whitespace-nowrap font-medium text-foreground"><Link href={repHref(c.userId)} className="underline-offset-2 hover:underline">{c.name}</Link></td>
                  <td className="whitespace-nowrap text-right tabular-nums">{c.policiesWorked.toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{pct(c.contactRate)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{c.blended.saved.toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{c.blended.lost.toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{c.blended.unreachable.toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{c.blended.pending.toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{c.conversions.toLocaleString("en-US")}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(c.premiumProtectedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
      </>}
    </>
  );
}

function ReasonTable({ lines, blended }: { lines: ReasonLine[]; blended: ReasonLine }) {
  if (!lines.length) return <EmptyState title="No cases in this period" hint="A case is one policy worked for one reason." />;
  const row = (l: ReasonLine, label: string, total = false) => (
    <tr key={label} data-total={total || undefined}>
      <td className="whitespace-nowrap font-medium text-foreground">{label}</td>
      <td className="whitespace-nowrap text-right tabular-nums">{l.cases.toLocaleString("en-US")}</td>
      <td className="whitespace-nowrap text-right tabular-nums">{l.unreachable.toLocaleString("en-US")}</td>
      <td className="whitespace-nowrap text-right tabular-nums">{l.saved.toLocaleString("en-US")}</td>
      <td className="whitespace-nowrap text-right tabular-nums">{l.lost.toLocaleString("en-US")}</td>
      <td className="whitespace-nowrap text-right tabular-nums">{l.pending.toLocaleString("en-US")}</td>
      <td className="whitespace-nowrap text-right tabular-nums">{rateText(l)}</td>
    </tr>
  );
  return (
    <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
      <thead>
        <tr>
          <th>Reason worked</th>
          <th className="text-right">Cases</th>
          <th className="text-right">
            <span className="inline-flex items-center gap-1">Unreachable <InfoTip label="About unreachable">Never reached a person: voicemail, no answer or a wrong number. A data-quality problem, kept out of the save rate.</InfoTip></span>
          </th>
          <th className="text-right">
            <span className="inline-flex items-center gap-1">Saved <InfoTip label="About saved">Reached, and still in force {SAVED_AFTER_DAYS} days after being worked.</InfoTip></span>
          </th>
          <th className="text-right">Lost</th>
          <th className="text-right">Too soon</th>
          <th className="text-right">
            <span className="inline-flex items-center gap-1">Save rate <InfoTip label="About save rate">Saved of saved and lost. Under {MIN_SAVE_SAMPLE} decided cases the counts are shown instead. Reasons differ enormously: a draft date is nearly always fixable, affordability nearly never.</InfoTip></span>
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => row(l, SAVE_REASON_LABELS[l.reason as keyof typeof SAVE_REASON_LABELS]))}
        {row(blended, "All reasons", true)}
      </tbody>
    </table>
  );
}

"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { MIN_SAVE_SAMPLE, rateText, SAVE_REASON_LABELS, SAVED_AFTER_DAYS, SCORECARD_PERIOD_LABELS, SCORECARD_PERIODS, type ReasonLine, type ScorecardPeriod } from "@/lib/retention/scorecard";
import type { Scorecard } from "@/lib/retention/scorecardStore";

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

/**
 * LA-5.8 (Notion sprint) · the retention scorecard. The save rate exists only in the by-reason table,
 * whose last row is the blended figure — never shown on its own. Under ten decided cases a reason shows
 * "3 of 5 saved", not a percentage. Unreachable cases have their own column and stay out of the rate.
 */
export function RetentionScorecardBoard({ data, period, selected, isOwner, viewerId }: { data: Scorecard; period: ScorecardPeriod; selected: string | null; isOwner: boolean; viewerId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, startRefresh] = useTransition();
  const go = (next: { period?: string; rep?: string | null }) => {
    const params = new URLSearchParams();
    const p = next.period ?? period;
    if (p !== "180") params.set("period", p);
    const r = next.rep === undefined ? selected : next.rep;
    if (r) params.set("rep", r);
    router.push(params.size ? `${pathname}?${params}` : pathname);
  };
  const card = data.cards.find((c) => c.userId === (selected ?? (isOwner ? data.cards[0]?.userId : viewerId))) ?? null;
  const toolbar = (
    <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
      <select aria-label="Period" className={toolbarControl} value={period} onChange={(e) => go({ period: e.target.value })}>
        {(Object.keys(SCORECARD_PERIODS) as ScorecardPeriod[]).map((p) => <option key={p} value={p}>{SCORECARD_PERIOD_LABELS[p]}</option>)}
      </select>
      {isOwner && data.cards.length > 1 && (
        <select aria-label="Person" className={toolbarControl} value={card?.userId ?? ""} onChange={(e) => go({ rep: e.target.value })}>
          {data.cards.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
        </select>
      )}
      <span className="text-sm text-muted-foreground">
        {fileDay(data.from)} – {fileDay(data.to)}
        {data.holdoutExcluded ? ` · ${data.holdoutExcluded.toLocaleString("en-US")} held-out ${data.holdoutExcluded === 1 ? "policy" : "policies"} left out` : ""}
      </span>
    </DataToolbar>
  );

  if (!data.cards.length) {
    return (
      <TableCard toolbar={toolbar}>
        <EmptyState title="Nothing worked in this period" hint="Calls logged on the Save queue and the paper-bill campaign, and reinstatements the carrier confirmed, show here." />
      </TableCard>
    );
  }

  return (
    <>
      {card && (
        <StatStrip label={`${card.name}'s retention`}>
          <StatTile label="Policies worked" value={card.policiesWorked.toLocaleString("en-US")} footnote={`${card.attempts.toLocaleString("en-US")} calls`} />
          <StatTile label="Contact rate" value={pct(card.contactRate)} labelTitle="Calls that reached a person, of all calls. Voicemails and wrong numbers are a data problem, not a failure: they are kept out of the save rate." footnote={`${card.reached.toLocaleString("en-US")} reached a person`} />
          <StatTile label="Conversions" value={card.conversions.toLocaleString("en-US")} labelTitle="Paper bill switched to bank draft, counted once a carrier file proved it." footnote="paper bill → bank, verified" />
          <StatTile label="Reinstatements" value={card.reinstatements.toLocaleString("en-US")} footnote="confirmed by a carrier file" />
          <StatTile label="Premium protected" value={money(card.premiumProtectedCents)} labelTitle={`Annual premium of the policies still in force ${SAVED_AFTER_DAYS} days after being worked.`} footnote={`advance protected ${money(card.advanceProtectedCents)}`} />
        </StatStrip>
      )}

      <TableCard toolbar={toolbar}>
        {card ? <ReasonTable lines={card.byReason} blended={card.blended} /> : null}
      </TableCard>

      {isOwner && data.cards.length > 1 && (
        <TableCard>
          <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr>
                <th>Person</th>
                <th className="text-right">Policies worked</th>
                <th className="text-right">Contact rate</th>
                <th className="text-right">Conversions</th>
                <th className="text-right">Reinstatements</th>
                <th className="text-right">Advance protected</th>
                <th className="w-[110px] text-right"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {data.cards.map((c) => (
                <tr key={c.userId}>
                  <td className="font-semibold text-foreground">{c.name}</td>
                  <td className="text-right tabular-nums">{c.policiesWorked.toLocaleString("en-US")}</td>
                  <td className="text-right tabular-nums">{pct(c.contactRate)}</td>
                  <td className="text-right tabular-nums">{c.conversions.toLocaleString("en-US")}</td>
                  <td className="text-right tabular-nums">{c.reinstatements.toLocaleString("en-US")}</td>
                  <td className="text-right tabular-nums">{money(c.advanceProtectedCents)}</td>
                  <td className="text-right"><Button size="sm" variant="outline" onClick={() => go({ rep: c.userId })}>Save rate</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </>
  );
}

function ReasonTable({ lines, blended }: { lines: ReasonLine[]; blended: ReasonLine }) {
  if (!lines.length) return <EmptyState title="No cases in this period" hint="A case is one policy worked for one reason." />;
  const row = (l: ReasonLine, label: string, total = false) => (
    <tr key={label} className={total ? "font-semibold" : undefined}>
      <td className="text-foreground">{label}</td>
      <td className="text-right tabular-nums">{l.cases.toLocaleString("en-US")}</td>
      <td className="text-right tabular-nums">{l.unreachable.toLocaleString("en-US")}</td>
      <td className="text-right tabular-nums">{l.saved.toLocaleString("en-US")}</td>
      <td className="text-right tabular-nums">{l.lost.toLocaleString("en-US")}</td>
      <td className="text-right tabular-nums">{l.pending.toLocaleString("en-US")}</td>
      <td className="text-right tabular-nums">{rateText(l)}</td>
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

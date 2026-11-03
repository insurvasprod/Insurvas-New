"use client";

import { useState } from "react";
import Link from "next/link";

import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { Button } from "@/components/ui/button";
import { PeriodPicker, lastDays, type Period } from "@/components/app/reports/period-picker";
import { downloadCsv } from "@/components/app/partner-quality-parts";
import { keepSharedPeriod } from "@/lib/reports/views";
import { dollars } from "@/lib/agency/constants";
import { Money } from "./money";
import { useAgencyData } from "./use-agency-data";

type PerPolicy = { kind: "rate"; cents: number; policies: number } | { kind: "counts"; spendCents: number; policies: number } | { kind: "none" };
type Persisting = { kind: "building"; horizon: number; monthsElapsed: number; readyOn: string } | { kind: "figure"; horizon: number; issued: number; alive: number; perPolicy: PerPolicy };
type Score = {
  producerUserId: string; name: string; submitted: number; issued: number; placement: string;
  m4: { text: string }; m13: { text: string }; chargebackCents: number; advanceAtRiskCents: number; leadSpendCents: number;
  costPerIssued: PerPolicy; costPerPersisting: Persisting; chargebackTaxCents: number | null;
};

const perPolicyText = (p: PerPolicy) => (p.kind === "rate" ? dollars(p.cents) : p.kind === "counts" ? `${dollars(p.spendCents)} / ${p.policies}` : "—");
const persistingText = (p: Persisting) => (p.kind === "building" ? `Ready ${p.readyOn.slice(0, 7)}` : perPolicyText(p.perPolicy));

/**
 * AG-1.9 · producer scorecards — who is profitable, not just busy. A Reports view since 2026-11-03 (out of Team;
 * same address). Every column is an existing engine's figure grouped by producer (LA-4.18 placement and
 * persistency, LA-7 cost per issued / per persisting policy). The gap between the two cost columns is the
 * chargeback tax. Lead cost follows the producer the lead was ASSIGNED to. Under the sample a count, never a
 * percentage; a producer sees only his own row.
 *
 * The Reports period (`?from&to`, the shared PeriodPicker) is first in the toolbar and rides along to the other
 * views; Export CSV gives the rows on screen. A producer's name opens his policies in the book.
 */
export function ScorecardsBoard({ scoped, initialPeriod }: { scoped: boolean; initialPeriod?: Period | null }) {
  const [period, setPeriod] = useState<Period>(() => initialPeriod ?? lastDays(90));
  const { data, error, loading, refreshing, reload } = useAgencyData<{ available: boolean; rows: Score[]; minSample: number }>(`/api/app/agency/scorecards?from=${period.from}&to=${period.to}`);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(400, 45);
  const rows = data?.rows ?? [];
  const shown = paginate(rows, page, pageSize);
  const worstTax = rows.reduce<Score | null>((w, r) => ((r.chargebackTaxCents ?? -1) > (w?.chargebackTaxCents ?? -1) ? r : w), null);
  const submitted = rows.reduce((s, r) => s + r.submitted, 0);
  const issued = rows.reduce((s, r) => s + r.issued, 0);
  const chargebacks = rows.reduce((s, r) => s + r.chargebackCents, 0);
  const atRisk = rows.reduce((s, r) => s + r.advanceAtRiskCents, 0);
  const change = (next: Period) => { setPeriod(next); setPage(1); keepSharedPeriod(next); };

  const exportCsv = () => downloadCsv(`producer-scorecards-${period.from}-${period.to}.csv`,
    ["Producer", "Submitted", "Issued", "Placement", "Month 4", "Month 13", "Chargebacks", "At risk", "Cost per issued", "Cost per persisting"],
    rows.map((r) => [r.name, r.submitted, r.issued, r.placement, r.m4.text, r.m13.text, dollars(r.chargebackCents), dollars(r.advanceAtRiskCents), perPolicyText(r.costPerIssued), persistingText(r.costPerPersisting)]));

  return (
    <>
      {data?.available && rows.length > 0 && !scoped && (
        <StatStrip label="Producer scorecards">
          <StatTile label="Submitted" value={String(submitted)} />
          <StatTile label="Issued" value={String(issued)} />
          <StatTile label="Chargebacks" value={dollars(chargebacks)} valueTone={chargebacks ? "danger" : undefined} />
          <StatTile label="Advance at risk" value={dollars(atRisk)} valueTone={atRisk ? "warning" : undefined} />
        </StatStrip>
      )}
      <TableCard
        toolbar={
          <DataToolbar actions={<>{rows.length > 0 && <Button type="button" variant="outline" onClick={exportCsv}>Export CSV</Button>}<RefreshButton onClick={reload} refreshing={refreshing} /></>}>
            <PeriodPicker value={period} onChange={change} />
          </DataToolbar>
        }
        footer={data?.available && rows.length ? <Pager page={shown.current} total={rows.length} noun="producers" pageSize={pageSize} onPage={setPage} /> : undefined}
      >
        {error ? <ErrorState detail={error} /> : loading || !data ? <SectionLoading rows={5} columns={10} label="Loading scorecards" /> : !data.available ? (
          <EmptyState title="No carrier files yet" hint="Scorecards are built from your carriers' policy files. Bring one in under Book of business › Files." action={scoped ? undefined : <Button asChild variant="outline"><Link href="/app/carrier-files">Open Files</Link></Button>} />
        ) : rows.length === 0 ? <EmptyState title="No producers yet" hint="Each producer's row appears once they are active." /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producer</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead className="text-right" title={`Counts until ${data.minSample} policies, then percentages`}>Placement</TableHead>
                <TableHead className="text-right" title="Still paying at month 4 and month 13">Month 4 · 13</TableHead>
                <TableHead className="text-right">Chargebacks</TableHead>
                <TableHead className="text-right">At risk</TableHead>
                <TableHead className="text-right" title="Lead cost per issued policy">Cost/issued</TableHead>
                <TableHead className="text-right" title="Lead cost per persisting policy (still paying at the horizon); the gap to cost/issued is the chargeback tax">Cost/alive</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.rows.map((r) => (
                <TableRow key={r.producerUserId} className={worstTax?.producerUserId === r.producerUserId && (r.chargebackTaxCents ?? 0) > 0 && rows.length > 1 ? "bg-[var(--warning-surface)]" : undefined}>
                  <TableCell className="font-medium"><Link className="hover:underline" href={`/app/policies?agent=${r.producerUserId}`} title={`Open ${r.name}'s policies`}>{r.name}</Link></TableCell>
                  <TableCell className="text-right tabular-nums">{r.submitted}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.issued}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.placement}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.m4.text} · {r.m13.text}</TableCell>
                  <TableCell className="text-right"><Money cents={r.chargebackCents} /></TableCell>
                  <TableCell className="text-right"><Money cents={r.advanceAtRiskCents} /></TableCell>
                  <TableCell className="text-right tabular-nums">{perPolicyText(r.costPerIssued)}</TableCell>
                  <TableCell className="text-right tabular-nums" title={r.costPerPersisting.kind === "building" ? `Needs more issue history: ready ${r.costPerPersisting.readyOn}` : undefined}>{r.costPerPersisting.kind === "building" ? "Building" : persistingText(r.costPerPersisting)}{r.chargebackTaxCents !== null && r.chargebackTaxCents > 0 && <div className="text-xs text-[var(--warning-ink)]" title="The chargeback tax: what chargebacks add to each persisting policy">+{dollars(r.chargebackTaxCents)} tax</div>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </>
  );
}

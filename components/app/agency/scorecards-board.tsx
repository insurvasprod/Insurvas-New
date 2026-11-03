"use client";

import { useMemo, useState } from "react";

import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/view-tabs";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { InfoTip } from "@/components/ui/info-tip";
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
const persistingText = (p: Persisting) => (p.kind === "building" ? `Ready ${p.readyOn}` : perPolicyText(p.perPolicy));

function quarter(offset = 0) {
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) + offset;
  const start = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/**
 * AG-1.9 · producer scorecards — who is profitable, not just busy. Every column is an existing engine's figure
 * grouped by producer (LA-4.18 placement and persistency, LA-7 cost per issued / per persisting policy). The gap
 * between the two cost columns is the chargeback tax. Lead cost follows the producer the lead was ASSIGNED to.
 * Under the sample a count, never a percentage; a producer sees only his own row.
 */
export function ScorecardsBoard({ scoped }: { scoped: boolean }) {
  const [which, setWhich] = useState<"this" | "last">("this");
  const range = useMemo(() => quarter(which === "this" ? 0 : -1), [which]);
  const { data, error, loading, refreshing, reload } = useAgencyData<{ available: boolean; rows: Score[]; minSample: number }>(`/api/app/agency/scorecards?from=${range.from}&to=${range.to}`);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 45);
  const shown = paginate(data?.rows ?? [], page, pageSize);
  const worstTax = data?.rows.reduce<Score | null>((w, r) => ((r.chargebackTaxCents ?? -1) > (w?.chargebackTaxCents ?? -1) ? r : w), null);

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Producer scorecards" description={scoped ? "Your production, persistency and what your business costs." : "Which producers are profitable, not just busy."} actions={<Segmented label="Period" value={which} onChange={setWhich} options={[{ key: "this", label: "This quarter" }, { key: "last", label: "Last quarter" }]} />} />
      <TableCard toolbar={<DataToolbar actions={<RefreshButton onClick={reload} refreshing={refreshing} />} />} footer={data?.available && data.rows.length ? <Pager page={shown.current} total={data.rows.length} noun="producers" pageSize={pageSize} onPage={setPage} /> : undefined}>
        {error ? <ErrorState detail={error} /> : loading || !data ? <SectionLoading rows={5} columns={9} label="Loading scorecards" /> : !data.available ? (
          <EmptyState title="No carrier files yet" hint="Scorecards are built from your carriers' policy files. Import one under Data in." />
        ) : data.rows.length === 0 ? <EmptyState title="No producers yet" hint="Each producer's row appears once they are active." /> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producer</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead className="text-right">Placement <InfoTip label="About placement and persistency">{`Placement and persistency show counts until ${data.minSample} policies, then percentages.`}</InfoTip></TableHead>
                <TableHead className="text-right">Month 4</TableHead>
                <TableHead className="text-right">Month 13</TableHead>
                <TableHead className="text-right">Chargebacks</TableHead>
                <TableHead className="text-right">At risk</TableHead>
                <TableHead className="text-right">Cost / issued</TableHead>
                <TableHead className="text-right">Cost / persisting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.rows.map((r) => (
                <TableRow key={r.producerUserId} className={worstTax?.producerUserId === r.producerUserId && (r.chargebackTaxCents ?? 0) > 0 && data.rows.length > 1 ? "bg-[var(--warning-surface)]" : undefined}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.submitted}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.issued}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.placement}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.m4.text}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.m13.text}</TableCell>
                  <TableCell className="text-right"><Money cents={r.chargebackCents} /></TableCell>
                  <TableCell className="text-right"><Money cents={r.advanceAtRiskCents} /></TableCell>
                  <TableCell className="text-right tabular-nums">{perPolicyText(r.costPerIssued)}</TableCell>
                  <TableCell className="text-right tabular-nums">{persistingText(r.costPerPersisting)}{r.chargebackTaxCents !== null && r.chargebackTaxCents > 0 && <div className="text-xs text-[var(--warning-ink)]">+{dollars(r.chargebackTaxCents)} chargeback tax</div>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/view-tabs";
import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, ToolbarCheckbox } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { BasisChip, Money } from "./money";
import { sendJson, useAgencyData } from "./use-agency-data";

type Truth = { producerUserId: string; expectedCents: number | null; reportedCents: number; receivedCents: number; expectedMissingLevels: number };
type Review = { id: string; producerUserId: string; kind: "expected_reported" | "reported_received"; varianceCents: number; status: "open" | "reviewed"; note: string | null };
type Producer = { userId: string; displayName: string };

function month(offset: number) {
  const now = new Date();
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0)).toISOString().slice(0, 10),
  };
}

/**
 * AG-1.12 · expected (rate card × his level), reported (the carrier statement) and received (the bank), per producer
 * — three numbers, never averaged. The two variances are named, not netted. A variance over the threshold becomes
 * an open item; nothing resolves it automatically toward whichever number is largest.
 */
export function ReconciliationBoard({ canReview }: { canReview: boolean }) {
  const [which, setWhich] = useState<"this" | "last">("last");
  const range = useMemo(() => month(which === "this" ? 0 : -1), [which]);
  const { data, error, loading, refreshing, reload } = useAgencyData<{ rows: Truth[]; reviews: Review[]; threshold: number }>(`/api/app/agency/reconciliation?from=${range.from}&to=${range.to}`);
  const roster = useAgencyData<{ rows: Producer[] }>("/api/app/agency/producers");
  const [overOnly, setOverOnly] = useState(false);
  const name = useMemo(() => new Map((roster.data?.rows ?? []).map((p) => [p.userId, p.displayName])), [roster.data]);
  const openFor = (producer: string) => (data?.reviews ?? []).filter((r) => r.producerUserId === producer && r.status === "open");
  const rows = (data?.rows ?? []).filter((r) => !overOnly || openFor(r.producerUserId).length > 0);

  async function markReviewed(item: Review) {
    const text = (document.getElementById(`note-${item.id}`) as HTMLInputElement | null)?.value ?? "";
    const { error: message } = await sendJson("/api/app/agency/reconciliation", "POST", { itemId: item.id, note: text });
    if (message) { notify.fail(message); return; }
    notify.done("Marked reviewed. The numbers are unchanged; a correction is an adjustment on the ledger.");
    reload();
  }

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Producer reconciliation" description="Expected, reported and received, per producer — never blended." actions={<Segmented label="Period" value={which} onChange={setWhich} options={[{ key: "last", label: "Last month" }, { key: "this", label: "This month" }]} />} />
      <TableCard toolbar={
        <DataToolbar actions={<RefreshButton onClick={reload} refreshing={refreshing} />}>
          <ToolbarCheckbox checked={overOnly} onChange={setOverOnly} label="Over the threshold only" />
        </DataToolbar>
      }>
        {error ? <ErrorState detail={error} /> : loading || !data ? <SectionLoading rows={4} columns={6} label="Reconciling" /> : rows.length === 0 ? (
          <EmptyState title={overOnly ? "Nothing over the threshold" : "No producers yet"} hint="Each producer's three numbers appear once statements are posted." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producer</TableHead>
                <TableHead className="text-right"><BasisChip basis="expected" /></TableHead>
                <TableHead className="text-right"><BasisChip basis="reported" /></TableHead>
                <TableHead className="text-right"><BasisChip basis="received" /></TableHead>
                <TableHead className="text-right">Expected → reported</TableHead>
                <TableHead className="text-right">Reported → received</TableHead>
                <TableHead>Review <InfoTip label="About review items">{`A difference over $${(data.threshold / 100).toFixed(0)} opens a review item.`}</InfoTip></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const items = openFor(r.producerUserId);
                return (
                  <TableRow key={r.producerUserId} className={items.length ? "bg-[var(--warning-surface)] align-top" : "align-top"}>
                    <TableCell className="font-medium">{name.get(r.producerUserId) ?? "Producer"}{r.expectedMissingLevels > 0 && <div className="text-xs text-[var(--warning-ink)]">{r.expectedMissingLevels} {r.expectedMissingLevels === 1 ? "policy" : "policies"} with no level — not in expected</div>}</TableCell>
                    <TableCell className="text-right"><Money cents={r.expectedCents} /></TableCell>
                    <TableCell className="text-right"><Money cents={r.reportedCents} /></TableCell>
                    <TableCell className="text-right"><Money cents={r.receivedCents} /></TableCell>
                    <TableCell className="text-right">{r.expectedCents === null ? "—" : <Money cents={r.reportedCents - r.expectedCents} />}</TableCell>
                    <TableCell className="text-right"><Money cents={r.receivedCents - r.reportedCents} /></TableCell>
                    <TableCell>
                      {items.length === 0 ? <StatusChip tone="good">Within threshold</StatusChip> : items.map((i) => (
                        <div key={i.id} className="flex items-center gap-2 py-0.5">
                          <StatusChip tone="warning">{i.kind === "expected_reported" ? "Expected vs reported" : "Reported vs received"}</StatusChip>
                          {canReview && <><input id={`note-${i.id}`} aria-label="What you found" placeholder="What you found" className="h-8 w-40 rounded-md border border-input px-2 text-sm" /><Button size="sm" variant="outline" onClick={() => markReviewed(i)}>Mark reviewed</Button></>}
                        </div>
                      ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </div>
  );
}

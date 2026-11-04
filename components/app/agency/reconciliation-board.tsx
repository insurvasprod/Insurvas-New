"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { Segmented } from "@/components/ui/view-tabs";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, textareaControl } from "@/components/ui/field";
import { BasisChip, Money } from "./money";
import { sendJson, useAgencyData } from "./use-agency-data";
import type { ProducerPayFigure } from "@/lib/commissions/producerPayFigures";

type Truth = { producerUserId: string; expectedCents: number | null; reportedCents: number; receivedCents: number; expectedMissingLevels: number };
type Review = { id: string; producerUserId: string; kind: "expected_reported" | "reported_received"; varianceCents: number; status: "open" | "reviewed"; note: string | null };
type Producer = { id: string; userId: string; displayName: string };

const KIND_LABEL: Record<Review["kind"], string> = { expected_reported: "Expected vs reported", reported_received: "Reported vs received" };

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
 *
 * Board 14 (2026-11-03, light touch): the list leads with Pay, what each producer Earned, was Advanced and was
 * Charged back in the month, and is Owed at its end (reported basis, read by the page); Three truths is the
 * switch beside it. The whole row opens the producer's Money tab; a row's own button is only its Review.
 */
export function ReconciliationBoard({ canReview, pay }: { canReview: boolean; /** Per month, from the page; null where the read failed. */ pay?: { last: ProducerPayFigure[] | null; this: ProducerPayFigure[] | null } }) {
  const router = useRouter();
  const [which, setWhich] = useState<"this" | "last">("last");
  const [columns, setColumns] = useState<"pay" | "truths">("pay");
  const payOf = useMemo(() => {
    const figures = pay?.[which];
    return figures ? new Map(figures.map((f) => [f.producerUserId, f])) : null;
  }, [pay, which]);
  const range = useMemo(() => month(which === "this" ? 0 : -1), [which]);
  const { data, error, loading, refreshing, reload } = useAgencyData<{ rows: Truth[]; reviews: Review[]; threshold: number }>(`/api/app/agency/reconciliation?from=${range.from}&to=${range.to}`);
  const roster = useAgencyData<{ rows: Producer[] }>("/api/app/agency/producers");
  const [overOnly, setOverOnly] = useState(false);
  const name = useMemo(() => new Map((roster.data?.rows ?? []).map((p) => [p.userId, p.displayName])), [roster.data]);
  const recordOf = useMemo(() => new Map((roster.data?.rows ?? []).map((p) => [p.userId, p.id])), [roster.data]);
  const openFor = (producer: string) => (data?.reviews ?? []).filter((r) => r.producerUserId === producer && r.status === "open");
  const overCount = (data?.rows ?? []).filter((r) => openFor(r.producerUserId).length > 0).length;
  const rows = (data?.rows ?? []).filter((r) => !overOnly || openFor(r.producerUserId).length > 0);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 57);
  const shown = paginate(rows, page, pageSize);
  // The review is a dialog (owner 2026-11-02, the foundations): the note and the decision, never a field in a row.
  const [reviewing, setReviewing] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function markReviewed() {
    if (!reviewing) return;
    setSaving(true);
    const { error: message } = await sendJson("/api/app/agency/reconciliation", "POST", { itemId: reviewing.id, note: note.trim() });
    setSaving(false);
    if (message) { notify.fail(message); return; }
    notify.done("Marked reviewed. The numbers are unchanged; a correction is an adjustment on the ledger.");
    setReviewing(null);
    reload();
  }

  return (
    // Commissions › Producer pay (2026-11-02): the one Commissions page draws the title.
    <>
      <TableCard toolbar={
        // The period sits on the Refresh line (owner 2026-11-02): the toolbar's controls, one row.
        <DataToolbar actions={<><Segmented label="Period" value={which} onChange={setWhich} options={[{ key: "last", label: "Last month" }, { key: "this", label: "This month" }]} /><RefreshButton onClick={reload} refreshing={refreshing} /></>}>
          <Segmented label="Columns" value={columns} onChange={setColumns} options={[{ key: "pay", label: "Pay" }, { key: "truths", label: "Three truths" }]} />
          <ToggleChip selected={overOnly} count={data ? overCount : undefined} countTone={overCount > 0 ? "warning" : undefined} onClick={() => { setOverOnly(!overOnly); setPage(1); }}>Needs a review</ToggleChip>
        </DataToolbar>
      } footer={data && rows.length ? <Pager page={shown.current} total={rows.length} noun="producers" pageSize={pageSize} onPage={setPage} /> : undefined}>
        {error ? <ErrorState detail={error} /> : loading || !data ? <SectionLoading rows={4} columns={6} label="Reconciling" /> : rows.length === 0 ? (
          <EmptyState title={overOnly ? "Nothing needs a review" : "No producers yet"} hint="Each producer's three numbers appear once statements are posted." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producer</TableHead>
                {columns === "pay" ? <>
                  <TableHead className="text-right">Earned</TableHead>
                  <TableHead className="text-right">Advanced</TableHead>
                  <TableHead className="text-right">Charged back</TableHead>
                  <TableHead className="text-right">Owed <BasisChip basis="reported" /> <InfoTip label="About these figures">The month&apos;s figures from the carrier statements, the basis payouts are made on. Owed is the balance at the month&apos;s end, after payouts.</InfoTip></TableHead>
                </> : <>
                  <TableHead className="text-right"><BasisChip basis="expected" /></TableHead>
                  <TableHead className="text-right"><BasisChip basis="reported" /></TableHead>
                  <TableHead className="text-right"><BasisChip basis="received" /></TableHead>
                  <TableHead className="text-right">Expected → reported</TableHead>
                  <TableHead className="text-right">Reported → received</TableHead>
                </>}
                <TableHead>Review <InfoTip label="About review items">{`A difference over $${(data.threshold / 100).toFixed(0)} opens a review item.`}</InfoTip></TableHead>
                <TableHead className="w-9"><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.rows.map((r) => {
                const items = openFor(r.producerUserId);
                // The producer's own Money tab holds every statement behind these numbers: the whole row opens it.
                const record = recordOf.has(r.producerUserId) ? `/app/producers/${recordOf.get(r.producerUserId)}?tab=money` : null;
                // No ledger line in the month is $0 earned; a read that failed is "—".
                const figure = payOf ? payOf.get(r.producerUserId) ?? { earnedCents: 0, advancedCents: 0, chargedBackCents: 0, owedCents: 0 } : null;
                return (
                  <TableRow key={r.producerUserId} className={record ? "cursor-pointer align-top" : "align-top"} onClick={record ? () => router.push(record) : undefined}>
                    <TableCell className="font-medium">
                      {record
                        ? <Link href={record} onClick={(event) => event.stopPropagation()} className="hover:text-[var(--accent-ink)] hover:underline">{name.get(r.producerUserId)}</Link>
                        : name.get(r.producerUserId) ?? "Producer"}
                      {r.expectedMissingLevels > 0 && <div className="text-xs font-normal text-[var(--warning-ink)]">{r.expectedMissingLevels} {r.expectedMissingLevels === 1 ? "policy" : "policies"} with no level, not in expected</div>}
                    </TableCell>
                    {columns === "pay" ? <>
                      <TableCell className="text-right"><Money cents={figure?.earnedCents} /></TableCell>
                      <TableCell className="text-right"><Money cents={figure?.advancedCents} /></TableCell>
                      <TableCell className="text-right"><Money cents={figure?.chargedBackCents} /></TableCell>
                      <TableCell className="text-right font-semibold"><Money cents={figure?.owedCents} /></TableCell>
                    </> : <>
                      <TableCell className="text-right"><Money cents={r.expectedCents} /></TableCell>
                      <TableCell className="text-right"><Money cents={r.reportedCents} /></TableCell>
                      <TableCell className="text-right"><Money cents={r.receivedCents} /></TableCell>
                      <TableCell className="text-right">{r.expectedCents === null ? "—" : <Money cents={r.reportedCents - r.expectedCents} />}</TableCell>
                      <TableCell className="text-right"><Money cents={r.receivedCents - r.reportedCents} /></TableCell>
                    </>}
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      {items.length === 0 ? <StatusChip tone="good">Within threshold</StatusChip> : items.map((i) => (
                        <div key={i.id} className="flex items-center gap-2 py-0.5">
                          <StatusChip tone="warning">{KIND_LABEL[i.kind]}</StatusChip>
                          {canReview && <Button size="sm" variant="outline" onClick={() => { setNote(""); setReviewing(i); }}>Review</Button>}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground" aria-hidden="true">{record ? "›" : ""}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>

      <Dialog open={!!reviewing} onOpenChange={(open) => { if (!open) setReviewing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review {reviewing ? name.get(reviewing.producerUserId) ?? "the producer" : ""}</DialogTitle>
            <DialogDescription>
              {reviewing && <>{KIND_LABEL[reviewing.kind]}: <Money cents={reviewing.varianceCents} />. Marking it reviewed changes no number.</>}
            </DialogDescription>
          </DialogHeader>
          <Field label="What you found" htmlFor="review-note" hint="For example: the carrier pays this level next cycle.">
            <textarea id="review-note" className={textareaControl} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewing(null)}>Cancel</Button>
            <Button onClick={markReviewed} disabled={saving}>{saving ? "Saving…" : "Mark reviewed"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

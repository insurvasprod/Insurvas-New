"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
 */
export function ReconciliationBoard({ canReview }: { canReview: boolean }) {
  const [which, setWhich] = useState<"this" | "last">("last");
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
                <TableHead className="text-right"><BasisChip basis="expected" /></TableHead>
                <TableHead className="text-right"><BasisChip basis="reported" /></TableHead>
                <TableHead className="text-right"><BasisChip basis="received" /></TableHead>
                <TableHead className="text-right">Expected → reported</TableHead>
                <TableHead className="text-right">Reported → received</TableHead>
                <TableHead>Review <InfoTip label="About review items">{`A difference over $${(data.threshold / 100).toFixed(0)} opens a review item.`}</InfoTip></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.rows.map((r) => {
                const items = openFor(r.producerUserId);
                return (
                  <TableRow key={r.producerUserId} className="align-top">
                    <TableCell className="font-medium">
                      {/* The producer's own Money tab holds every statement behind these numbers. */}
                      {recordOf.has(r.producerUserId)
                        ? <Link href={`/app/producers/${recordOf.get(r.producerUserId)}?tab=money`} className="hover:text-[var(--accent-ink)] hover:underline">{name.get(r.producerUserId)}</Link>
                        : name.get(r.producerUserId) ?? "Producer"}
                      {r.expectedMissingLevels > 0 && <div className="text-xs font-normal text-[var(--warning-ink)]">{r.expectedMissingLevels} {r.expectedMissingLevels === 1 ? "policy" : "policies"} with no level, not in expected</div>}
                    </TableCell>
                    <TableCell className="text-right"><Money cents={r.expectedCents} /></TableCell>
                    <TableCell className="text-right"><Money cents={r.reportedCents} /></TableCell>
                    <TableCell className="text-right"><Money cents={r.receivedCents} /></TableCell>
                    <TableCell className="text-right">{r.expectedCents === null ? "—" : <Money cents={r.reportedCents - r.expectedCents} />}</TableCell>
                    <TableCell className="text-right"><Money cents={r.receivedCents - r.reportedCents} /></TableCell>
                    <TableCell>
                      {items.length === 0 ? <StatusChip tone="good">Within threshold</StatusChip> : items.map((i) => (
                        <div key={i.id} className="flex items-center gap-2 py-0.5">
                          <StatusChip tone="warning">{KIND_LABEL[i.kind]}</StatusChip>
                          {canReview && <Button size="sm" variant="outline" onClick={() => { setNote(""); setReviewing(i); }}>Review</Button>}
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

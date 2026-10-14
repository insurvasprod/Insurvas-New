"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import {
  CARRIER_METHOD_LABELS, CARRIER_METHODS, NEXT_STEPS, OPEN_STATUSES, REQUEST_LABELS, REQUEST_TYPES, STATUS_LABELS, WAITING_STATUSES,
  describeChange, unprovableText, type CarrierMethod, type RequestStatus, type RequestType,
} from "@/lib/retention/servicing";
import type { ServicingRow } from "@/lib/retention/servicingStore";
import { ServicingRequestDialog } from "@/components/app/servicing-request-dialog";
import { notify } from "@/lib/notify";

const TONE: Record<RequestStatus, StatusTone> = {
  draft: "neutral", submitted: "info", awaiting_carrier: "info", confirmed_by_carrier: "warning", verified_in_file: "good", failed: "danger", cancelled: "neutral",
};
const VIEWS = { open: "Open", failed: "Not in the file", verified: "Verified", all: "Everything" } as const;
type View = keyof typeof VIEWS;
const field = `${toolbarControl} w-full`;
const labelClass = "grid gap-1.5 text-sm font-medium text-foreground";
const alertClass = "rounded-lg border border-[color-mix(in_srgb,var(--error)_24%,transparent)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]";
const STEP_LABEL: Partial<Record<RequestStatus, string>> = { submitted: "Mark sent", awaiting_carrier: "Carrier is on it", confirmed_by_carrier: "Carrier says done", cancelled: "Cancel" };
const day = (iso: string | null) => (iso ? fileDay(iso.slice(0, 10)) : null);

/**
 * LA-5.4 (Notion sprint) · servicing requests. Open by default; "Carrier says done" is still open —
 * only a carrier file closes it. A change the file can't show waits and says why; one the file
 * contradicts past its date is "Not in the file", with the reason, and is back on the save queue.
 */
export function ServicingBoard({ rows, carriers, verifiedLast30, initialStatus, readOnly }: { rows: ServicingRow[]; carriers: Array<{ id: string; name: string }>; verifiedLast30: number; initialStatus: View; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [view, setView] = useState<View>(initialStatus);
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const [stepping, setStepping] = useState<{ row: ServicingRow; to: RequestStatus } | null>(null);
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState<{ carrierId: string; policyNumber: string; type: RequestType } | null>(null);

  const visible = useMemo(() => rows.filter((r) => {
    if (type && r.type !== type) return false;
    if (view === "open") return OPEN_STATUSES.includes(r.status);
    if (view === "failed") return r.status === "failed";
    if (view === "verified") return r.status === "verified_in_file";
    return true;
  }), [rows, view, type]);
  const shown = paginate(visible, page, 10);
  const waiting = rows.filter((r) => WAITING_STATUSES.includes(r.status));
  const unprovable = waiting.filter((r) => r.unprovable.length > 0).length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const verified30 = verifiedLast30;
  const drafts = rows.filter((r) => r.status === "draft").length;
  const clear = () => { setType(""); setView("open"); setPage(1); };

  return (
    <>
      {rows.length > 0 && (
        <StatStrip label="Servicing">
          <StatTile label="Waiting on the file" value={waiting.length.toLocaleString("en-US")} footnote={drafts ? `${drafts} more not sent yet` : "sent, not yet shown by a carrier file"} />
          <StatTile label="Can't be proven" value={unprovable.toLocaleString("en-US")} valueTone={unprovable ? "warning" : undefined} labelTitle="The carrier's file doesn't carry the field that changed (most files have no draft day). These wait; map the column in the carrier's layout if the file has one." footnote={unprovable ? "the file doesn't show the field" : "every open change can be checked"} />
          <StatTile label="Not in the file" value={failed.toLocaleString("en-US")} valueTone={failed ? "danger" : undefined} footnote={failed ? "back on the save queue" : "no change has failed"} />
          <StatTile label="Verified" value={verified30.toLocaleString("en-US")} valueTone={verified30 ? "good" : undefined} footnote="by a carrier file, last 30 days" />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(type || view !== "open") && <ClearFiltersButton onClick={clear} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
            {!readOnly && <Button type="button" onClick={() => setStarting(true)}>New request</Button>}
          </>}>
            <select aria-label="Which requests" className={toolbarControl} value={view} onChange={(e) => { setView(e.target.value as View); setPage(1); }}>
              {(Object.keys(VIEWS) as View[]).map((v) => <option key={v} value={v}>{VIEWS[v]}</option>)}
            </select>
            <select aria-label="Kind of change" className={toolbarControl} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">Every change</option>
              {REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_LABELS[t]}</option>)}
            </select>
          </DataToolbar>
        }
        footer={visible.length > 10 ? <Pager page={shown.current} pageSize={10} total={visible.length} noun="requests" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No servicing requests yet" hint="Start one from a Save queue card, or with New request." />
        ) : visible.length === 0 ? (
          <NoMatches noun="requests" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[210px]">Client</th>
                <th>Change</th>
                <th className="w-[260px]">Where it stands</th>
                <th className="w-[160px]">With the carrier</th>
                <th className="w-[200px] text-right"><span className="sr-only">Next step</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="block font-semibold text-foreground">{r.clientName ?? "No client linked"}</span>
                    <Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="block text-xs text-muted-foreground hover:underline">{r.carrierName} · {r.policyNumber}</Link>
                    {r.requestedBy && <span className="block text-xs text-muted-foreground">Asked by {r.requestedBy}, {day(r.createdAt)}</span>}
                  </td>
                  <td>
                    <span className="block font-medium text-foreground">{REQUEST_LABELS[r.type]}</span>
                    {r.changes.map((c) => <span key={c.field} className="block text-xs text-muted-foreground">{describeChange(c)}</span>)}
                    {r.targetDraftReason && <span className="mt-1 block text-xs text-muted-foreground">&ldquo;{r.targetDraftReason}&rdquo;</span>}
                  </td>
                  <td>
                    <StatusChip tone={TONE[r.status]}>{STATUS_LABELS[r.status]}</StatusChip>
                    {r.status === "failed" && r.failureReason && <span className="mt-1 block text-xs text-[var(--error-ink)]">{r.failureReason}</span>}
                    {r.status === "verified_in_file" && <span className="mt-1 block text-xs text-muted-foreground">Shown by the carrier file of {day(r.verifiedSnapshotDate)}</span>}
                    {WAITING_STATUSES.includes(r.status) && r.unprovable.length > 0 && <span className="mt-1 block text-xs text-[var(--warning-ink)]">{unprovableText(r.unprovable, r.carrierName)}</span>}
                    {WAITING_STATUSES.includes(r.status) && !r.unprovable.length && <span className="mt-1 block text-xs text-muted-foreground">{r.checkedSnapshotDate ? `The file of ${day(r.checkedSnapshotDate)} doesn't show it yet` : "No carrier file since it was sent"}{r.expectedEffectiveDate ? ` · due by ${day(r.expectedEffectiveDate)}` : ""}</span>}
                    {r.status === "confirmed_by_carrier" && r.confirmedAt && <span className="block text-xs text-muted-foreground">Carrier said done {day(r.confirmedAt)}</span>}
                  </td>
                  <td className="text-xs">
                    {r.carrierMethod ? <span className="block text-foreground">{CARRIER_METHOD_LABELS[r.carrierMethod]}</span> : <span className="block text-muted-foreground">Not sent</span>}
                    {r.carrierReference && <span className="block text-muted-foreground">Ref {r.carrierReference}</span>}
                    {r.submittedAt && <span className="block text-muted-foreground">Sent {day(r.submittedAt)}</span>}
                  </td>
                  <td className="text-right">
                    {!readOnly && (
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {NEXT_STEPS[r.status].filter((s) => s !== "cancelled").slice(0, 1).map((to) => <Button key={to} type="button" onClick={() => setStepping({ row: r, to })}>{STEP_LABEL[to]}</Button>)}
                        {NEXT_STEPS[r.status].includes("cancelled") && <Button type="button" variant="ghost" onClick={() => setStepping({ row: r, to: "cancelled" })}>Cancel</Button>}
                        {r.status === "failed" && <Button type="button" onClick={() => setCreating({ carrierId: r.carrierId, policyNumber: r.policyNumber, type: r.type })}>Try again</Button>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {stepping && <StepDialog row={stepping.row} to={stepping.to} onClose={() => setStepping(null)} onDone={() => { setStepping(null); router.refresh(); }} />}
      {starting && <StartDialog carriers={carriers} onClose={() => setStarting(false)} onPick={(pick) => { setStarting(false); setCreating(pick); }} />}
      {creating && <ServicingRequestDialog carrierId={creating.carrierId} policyNumber={creating.policyNumber} type={creating.type} origin="client_request" fromQueue={false} onClose={() => setCreating(null)} onDone={() => { setCreating(null); router.refresh(); }} />}
    </>
  );
}

function StartDialog({ carriers, onClose, onPick }: { carriers: Array<{ id: string; name: string }>; onClose: () => void; onPick: (p: { carrierId: string; policyNumber: string; type: RequestType }) => void }) {
  const [carrierId, setCarrierId] = useState(carriers.length === 1 ? carriers[0].id : "");
  const [policyNumber, setPolicyNumber] = useState("");
  const [type, setType] = useState<RequestType>("draft_date_change");
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>New servicing request</DialogTitle>
          <DialogDescription>Which policy, and what changes.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label htmlFor="new-carrier" className={labelClass}>
            Carrier
            <select id="new-carrier" className={field} value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
              <option value="">Choose…</option>
              {carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label htmlFor="new-policy" className={labelClass}>Policy number<input id="new-policy" autoComplete="off" className={field} value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} /></label>
          <label htmlFor="new-type" className={labelClass}>
            Change
            <select id="new-type" className={field} value={type} onChange={(e) => setType(e.target.value as RequestType)}>
              {REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_LABELS[t]}</option>)}
            </select>
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!carrierId || !policyNumber.trim()} onClick={() => onPick({ carrierId, policyNumber: policyNumber.trim(), type })}>Next</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepDialog({ row, to, onClose, onDone }: { row: ServicingRow; to: RequestStatus; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<CarrierMethod | "">(row.carrierMethod ?? "");
  const [reference, setReference] = useState(row.carrierReference ?? "");
  const [formRef, setFormRef] = useState("");
  const [effective, setEffective] = useState(row.expectedEffectiveDate ?? "");
  const [confirmedOn, setConfirmedOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = to === "submitted" ? method !== "" : to === "cancelled" ? note.trim().length >= 3 : true;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/app/retention/servicing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "step", id: row.id, to,
          send: to === "submitted" ? { method, form_ref: formRef.trim() || null, reference: reference.trim() || null, expected_effective_date: effective || null } : null,
          reference: to !== "submitted" ? reference.trim() || null : null,
          confirmed_on: to === "confirmed_by_carrier" ? confirmedOn : null,
          note: to === "cancelled" ? note.trim() : null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That could not be saved.");
      notify.done(to === "confirmed_by_carrier" ? "Noted. It stays open until a carrier file shows the change." : to === "cancelled" ? "Cancelled." : "Saved.");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{STEP_LABEL[to]}: {REQUEST_LABELS[row.type].toLowerCase()}</DialogTitle>
          <DialogDescription>{row.clientName ?? row.policyNumber} · {row.carrierName} · {row.policyNumber}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {to === "submitted" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor="step-via" className={labelClass}>
                How
                <select id="step-via" className={field} value={method} onChange={(e) => setMethod(e.target.value as CarrierMethod | "")}>
                  <option value="">Choose…</option>
                  {CARRIER_METHODS.map((m) => <option key={m} value={m}>{CARRIER_METHOD_LABELS[m]}</option>)}
                </select>
              </label>
              <label htmlFor="step-ref" className={labelClass}>Their reference<input id="step-ref" autoComplete="off" className={field} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
              <label htmlFor="step-form" className={labelClass}>Form used<input id="step-form" autoComplete="off" className={field} value={formRef} onChange={(e) => setFormRef(e.target.value)} /></label>
              <label htmlFor="step-effective" className={labelClass}>Takes effect by<input id="step-effective" type="date" className={field} value={effective} onChange={(e) => setEffective(e.target.value)} /></label>
            </div>
          )}
          {(to === "awaiting_carrier" || to === "confirmed_by_carrier") && (
            <label htmlFor="step-ref2" className={labelClass}>Their reference<input id="step-ref2" autoComplete="off" className={field} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
          )}
          {to === "confirmed_by_carrier" && (
            <>
              <label htmlFor="step-on" className={labelClass}>They said it was done on<input id="step-on" type="date" className={field} value={confirmedOn} onChange={(e) => setConfirmedOn(e.target.value)} /></label>
              <p className="m-0 text-sm text-muted-foreground">This is what you were told. The request closes only when a carrier file shows the change.</p>
            </>
          )}
          {to === "cancelled" && (
            <label htmlFor="step-note" className={labelClass}>Why<textarea id="step-note" className={`${field} min-h-16 py-2`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          )}
          {error && <p role="alert" className={alertClass}>{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Back</Button>
          <Button type="button" disabled={!ready || busy} onClick={() => void save()}>{busy ? "Saving…" : STEP_LABEL[to]}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

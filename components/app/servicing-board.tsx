"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { DetailPanel } from "@/components/ui/detail-panel";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Callout } from "@/components/app/settings/primitives";
import { personName } from "@/lib/format/personName";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
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
const VIEWS = { open: "Open", failed: "Not in the file", verified: "Verified", all: "All" } as const;
type View = keyof typeof VIEWS;
const field = `${toolbarControl} w-full`;
const labelClass = "grid gap-1.5 text-sm font-medium text-foreground";
// "Cancel the request", not "Cancel": its dialog also has a button that only closes it (live test 2026-11-02).
const STEP_LABEL: Partial<Record<RequestStatus, string>> = { submitted: "Mark sent", awaiting_carrier: "Carrier is on it", confirmed_by_carrier: "Carrier says done", cancelled: "Cancel the request" };
const day = (iso: string | null) => (iso ? fileDay(iso.slice(0, 10)) : null);
const phoneText = (raw: string) => {
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
};

/**
 * LA-5.4 (Notion sprint) · servicing requests. Open by default; "Carrier says done" is still open —
 * only a carrier file closes it. A change the file can't show waits and says why; one the file
 * contradicts past its date is "Not in the file", with the reason, and is back on the save queue.
 *
 * 2026-11-02 tidy (owner): views are chips with their counts, each row is one line per fact and fits the
 * card, the next step is the row's one button, and a search finds a client or policy.
 */
export function ServicingBoard({ rows, carriers, verifiedLast30, initialStatus, readOnly }: { rows: ServicingRow[]; carriers: Array<{ id: string; name: string }>; verifiedLast30: number; initialStatus: View; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [view, setView] = useState<View>(initialStatus);
  const [type, setType] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [stepping, setStepping] = useState<{ row: ServicingRow; to: RequestStatus } | null>(null);
  const [starting, setStarting] = useState(false);
  const [creating, setCreating] = useState<{ carrierId: string; policyNumber: string; type: RequestType } | null>(null);
  // The whole request, beside the list (owner 2026-11-02 critique: every fact, without crowding the row).
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = detailId ? rows.find((r) => r.id === detailId) ?? null : null;

  const inView = (r: ServicingRow, v: View) => v === "all" || (v === "open" ? OPEN_STATUSES.includes(r.status) : v === "failed" ? r.status === "failed" : r.status === "verified_in_file");
  const counts = useMemo(() => Object.fromEntries((Object.keys(VIEWS) as View[]).map((v) => [v, rows.filter((r) => inView(r, v)).length])) as Record<View, number>, [rows]);
  const needle = search.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((r) => (!type || r.type === type) && inView(r, view)
    && (!needle || [r.clientName, r.policyNumber, r.carrierName, r.carrierReference].some((v) => v?.toLowerCase().includes(needle)))), [rows, view, type, needle]);
  const pageSize = useFittingPageSize(480, 57);
  const shown = paginate(visible, page, pageSize);
  const waiting = rows.filter((r) => WAITING_STATUSES.includes(r.status));
  const unprovable = waiting.filter((r) => r.unprovable.length > 0).length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const verified30 = verifiedLast30;
  const drafts = rows.filter((r) => r.status === "draft").length;
  const clear = () => { setType(""); setView("open"); setSearch(""); setPage(1); };

  return (
    <>
      {rows.length > 0 && (
        <StatStrip label="Servicing">
          <StatTile label="Waiting on the file" value={waiting.length.toLocaleString("en-US")} footnote={drafts ? `${drafts} not sent yet` : "sent, not in a file yet"} />
          <StatTile label="Can't be proven" value={unprovable.toLocaleString("en-US")} valueTone={unprovable ? "warning" : undefined} labelTitle="The carrier's file doesn't carry the field that changed (most files have no draft day). These wait; map the column in the carrier's layout if the file has one." footnote={unprovable ? "the file has no such field" : "every change can be checked"} />
          <StatTile label="Not in the file" value={failed.toLocaleString("en-US")} valueTone={failed ? "danger" : undefined} footnote={failed ? "back on the save queue" : "no change has failed"} />
          <StatTile label="Verified" value={verified30.toLocaleString("en-US")} valueTone={verified30 ? "good" : undefined} footnote="by a carrier file, last 30 days" />
        </StatStrip>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {(type || needle || view !== "open") && <ClearFiltersButton onClick={clear} />}
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
            {!readOnly && <Button type="button" onClick={() => setStarting(true)}>New request</Button>}
          </>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Client, policy or reference" />
            {(Object.keys(VIEWS) as View[]).map((v) => (
              <ToggleChip key={v} role="radio" selected={view === v} count={counts[v]} countTone={v === "failed" && counts.failed ? "danger" : undefined} onClick={() => { setView(v); setPage(1); }}>{VIEWS[v]}</ToggleChip>
            ))}
            <select aria-label="Kind of change" className={toolbarControl} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
              <option value="">Every change</option>
              {REQUEST_TYPES.map((t) => <option key={t} value={t}>{REQUEST_LABELS[t]}</option>)}
            </select>
          </DataToolbar>
        }
        footer={visible.length ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="requests" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No servicing requests yet" hint="Start one from a Save queue card, or with New request." />
        ) : visible.length === 0 ? (
          <NoMatches noun="requests" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Client</th>
                <th>Change</th>
                <th>Where it stands</th>
                <th className="w-[200px] text-right"><span className="sr-only">Next step</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {shown.rows.map((r) => {
                // The one line under the status: why it failed, what proved it, why it can't be proven, or what it waits on.
                const standing = r.status === "failed" ? r.failureReason
                  : r.status === "verified_in_file" ? `In the file of ${day(r.verifiedSnapshotDate)}`
                    : WAITING_STATUSES.includes(r.status) && r.unprovable.length ? unprovableText(r.unprovable, r.carrierName)
                      : WAITING_STATUSES.includes(r.status) ? `${r.checkedSnapshotDate ? `Not in the file of ${day(r.checkedSnapshotDate)} yet` : "No carrier file since"}${r.expectedEffectiveDate ? ` · due ${day(r.expectedEffectiveDate)}` : ""}`
                        : r.status === "confirmed_by_carrier" && r.confirmedAt ? `Carrier said done ${day(r.confirmedAt)}` : null;
                const standingTone = r.status === "failed" ? "text-[var(--error-ink)]" : WAITING_STATUSES.includes(r.status) && r.unprovable.length ? "text-[var(--warning-ink)]" : "text-muted-foreground";
                const changes = r.changes.map((c) => describeChange(c)).join(" · ");
                const carrier = r.status === "draft" ? "" : [r.carrierMethod ? CARRIER_METHOD_LABELS[r.carrierMethod] : null, r.carrierReference ? `Ref ${r.carrierReference}` : null, r.submittedAt ? `Sent ${day(r.submittedAt)}` : null].filter(Boolean).join(" · ");
                const next = NEXT_STEPS[r.status].filter((st) => st !== "cancelled")[0];
                return (
                  <tr key={r.id} className="m-row">
                    <td>
                      <button type="button" className="block max-w-[220px] truncate text-left font-semibold text-foreground underline-offset-2 hover:underline" onClick={() => setDetailId(r.id)}>{r.clientName ? personName(r.clientName) : "No client linked"}</button>
                      <Link href={`/app/policies/carrier/${r.carrierId}/${encodeURIComponent(r.policyNumber)}`} className="block truncate text-xs text-muted-foreground hover:underline" title={r.requestedBy ? `Asked by ${r.requestedBy}, ${day(r.createdAt)}` : undefined}>{r.carrierName} {r.policyNumber}</Link>
                    </td>
                    <td>
                      <span className="block font-medium text-foreground">{REQUEST_LABELS[r.type]}</span>
                      {changes && <span className="block max-w-[220px] truncate text-xs text-muted-foreground" title={r.targetDraftReason ? `${changes} · "${r.targetDraftReason}"` : changes}>{changes}</span>}
                    </td>
                    <td>
                      <StatusChip tone={TONE[r.status]}>{STATUS_LABELS[r.status]}</StatusChip>
                      {/* What it waits on, then how it went to the carrier (both in the title). */}
                      {(standing || carrier) && <span className={`mt-1 block max-w-[300px] truncate text-xs ${standing ? standingTone : "text-muted-foreground"}`} title={[standing, carrier].filter(Boolean).join(" · ")}>{standing ?? carrier}</span>}
                    </td>
                    <td className="text-right">
                      {!readOnly && (
                        <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                          {next && <Button type="button" variant="outline" size="sm" onClick={() => setStepping({ row: r, to: next })}>{STEP_LABEL[next]}</Button>}
                          {r.status === "failed" && <Button type="button" variant="outline" size="sm" onClick={() => setCreating({ carrierId: r.carrierId, policyNumber: r.policyNumber, type: r.type })}>Try again</Button>}
                          {NEXT_STEPS[r.status].includes("cancelled") && (
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <Button type="button" variant="ghost" size="icon-sm" aria-label={`More for ${r.clientName ? personName(r.clientName) : r.policyNumber}`} title="More"><MoreHorizontal aria-hidden="true" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setStepping({ row: r, to: "cancelled" })}>Cancel the request</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      {detail && (
        <DetailPanel
          mode="overlay"
          title={detail.clientName ? personName(detail.clientName) : "No client linked"}
          subtitle={`${REQUEST_LABELS[detail.type]} · ${detail.carrierName} ${detail.policyNumber}`}
          status={<StatusChip tone={TONE[detail.status]}>{STATUS_LABELS[detail.status]}</StatusChip>}
          onClose={() => setDetailId(null)}
          footer={!readOnly && (() => {
            const next = NEXT_STEPS[detail.status].filter((st) => st !== "cancelled")[0];
            return (
              <div className="flex flex-wrap justify-end gap-2">
                {NEXT_STEPS[detail.status].includes("cancelled") && <Button type="button" variant="ghost" onClick={() => { setDetailId(null); setStepping({ row: detail, to: "cancelled" }); }}>Cancel the request</Button>}
                {detail.status === "failed" && <Button type="button" variant="outline" onClick={() => { setDetailId(null); setCreating({ carrierId: detail.carrierId, policyNumber: detail.policyNumber, type: detail.type }); }}>Try again</Button>}
                {next && <Button type="button" onClick={() => { setDetailId(null); setStepping({ row: detail, to: next }); }}>{STEP_LABEL[next]}</Button>}
              </div>
            );
          })()}
        >
          <dl className="m-0 grid gap-4 text-sm">
            {([
              ["Phone", detail.phone ? <span className="select-all tabular-nums" title="Check the calling window and do-not-call list before dialling">{phoneText(detail.phone)}</span> : "None on file"],
              ["Policy", <Link key="p" href={`/app/policies/carrier/${detail.carrierId}/${encodeURIComponent(detail.policyNumber)}`} className="font-semibold text-[var(--accent-ink)] hover:underline">{detail.carrierName} {detail.policyNumber}</Link>],
              ["What changes", detail.changes.length ? <ul className="m-0 grid list-none gap-1 p-0">{detail.changes.map((c) => <li key={c.field}>{describeChange(c)}</li>)}</ul> : "—"],
              ["Why", detail.targetDraftReason ?? null],
              ["Where it stands", detail.status === "failed" ? detail.failureReason : detail.status === "verified_in_file" ? `Shown by the carrier file of ${day(detail.verifiedSnapshotDate)}` : WAITING_STATUSES.includes(detail.status) && detail.unprovable.length ? unprovableText(detail.unprovable, detail.carrierName) : WAITING_STATUSES.includes(detail.status) ? (detail.checkedSnapshotDate ? `The file of ${day(detail.checkedSnapshotDate)} doesn't show it yet` : "No carrier file since it was sent") : null],
              ["Due by", detail.expectedEffectiveDate ? day(detail.expectedEffectiveDate) : null],
              ["Sent to the carrier", detail.submittedAt ? [detail.carrierMethod ? CARRIER_METHOD_LABELS[detail.carrierMethod] : null, `on ${day(detail.submittedAt)}`].filter(Boolean).join(" ") : "Not yet"],
              ["Carrier reference", detail.carrierReference],
              ["Carrier said done", detail.confirmedAt ? day(detail.confirmedAt) : null],
              ["Asked by", detail.requestedBy ? `${detail.requestedBy}, ${day(detail.createdAt)}` : day(detail.createdAt)],
              ["Note", detail.note],
            ] as Array<[string, React.ReactNode]>).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([label, value]) => (
              <div key={label} className="grid gap-0.5">
                <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
                <dd className="m-0 text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </DetailPanel>
      )}
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
          {error && <Callout tone="error" title={error} />}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Back</Button>
          <Button type="button" disabled={!ready || busy} onClick={() => void save()}>{busy ? "Saving…" : STEP_LABEL[to]}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { notify } from "@/lib/notify";

import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { Level } from "./money";
import { sendJson, useAgencyData } from "./use-agency-data";

type CarrierRow = {
  carrierId: string; carrierName: string; agencyLevelBps: number | null; producerLevelBps: number | null; levelFrom: string | null;
  spreadBps: number | null; writingNumber: string | null; numberFrom: string | null; appointments: Array<{ state: string; status: string; expiresOn: string | null }>;
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * AG-0.9 / AG-1.1 Carriers tab · one row per carrier: his level beside the agency's, the spread, his writing number,
 * his appointments, each with its date. A missing level or number is a prompt, never a default. The owner edits in a
 * panel; a change starts on a date and never rewrites an earlier one. Two producers can never hold one number.
 */
export function ProducerCarriersTab({ producerId, canEdit }: { producerId: string; canEdit: boolean }) {
  const { data, error, loading, refreshing, reload } = useAgencyData<{ schemaPending: boolean; rows: CarrierRow[] }>(`/api/app/agency/producers/${producerId}/carriers`);
  const [editing, setEditing] = useState<CarrierRow | null>(null);
  const [level, setLevel] = useState("");
  const [number, setNumber] = useState("");
  const [from, setFrom] = useState(today());
  const [state, setState] = useState("");
  const [apptStatus, setApptStatus] = useState<"appointed" | "pending" | "terminated">("appointed");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 45);
  const shown = paginate(data?.rows ?? [], page, pageSize);

  const open = (row: CarrierRow) => { setEditing(row); setLevel(""); setNumber(row.writingNumber ?? ""); setFrom(today()); setState(""); setExpires(""); setProblem(null); };

  async function saveCarrier() {
    if (!editing) return;
    setBusy(true);
    const { error: message } = await sendJson(`/api/app/agency/producers/${producerId}/carriers`, "PUT", {
      carrierId: editing.carrierId,
      levelPercent: level.trim() || null,
      writingNumber: number.trim() && number.trim() !== editing.writingNumber ? number.trim() : null,
      effectiveFrom: from,
    });
    setBusy(false);
    if (message) { setProblem(message); return; }
    notify.done(`${editing.carrierName} saved from ${from}. Earlier policies keep the level they had.`);
    setEditing(null);
    reload();
  }

  async function saveAppointment() {
    if (!editing || !state.trim()) return;
    setBusy(true);
    const { error: message } = await sendJson(`/api/app/agency/producers/${producerId}/appointments`, "PUT", { carrierId: editing.carrierId, state: state.trim(), status: apptStatus, expiresOn: expires || null });
    setBusy(false);
    if (message) { setProblem(message); return; }
    notify.done(`${editing.carrierName} appointment in ${state.trim().toUpperCase()} saved.`);
    setState(""); setExpires("");
    reload();
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch">
      <TableCard className="min-w-0 flex-1" toolbar={<DataToolbar actions={<RefreshButton onClick={reload} refreshing={refreshing} />} />} footer={data && !data.schemaPending && data.rows.length ? <Pager page={shown.current} total={data.rows.length} noun="carriers" pageSize={pageSize} onPage={setPage} /> : undefined}>
        {error ? <ErrorState detail={error} /> : loading || !data ? <SectionLoading rows={4} columns={6} label="Loading carriers" /> : data.schemaPending ? (
          <EmptyState title="Not switched on yet" hint="Levels and writing numbers appear once the agency database update is applied." />
        ) : data.rows.length === 0 ? (
          <EmptyState title="No carriers yet" hint="Add the agency's carrier contracts on the rate card first; each producer's level is set against them here." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Carrier</TableHead>
                <TableHead className="text-right">Producer level</TableHead>
                <TableHead className="text-right">Agency level</TableHead>
                <TableHead className="text-right">Spread</TableHead>
                <TableHead>Writing no.</TableHead>
                <TableHead>Appointments</TableHead>
                <TableHead>From</TableHead>
                {canEdit && <TableHead className="text-right" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.rows.map((r) => (
                <TableRow key={r.carrierId} className={editing?.carrierId === r.carrierId ? "bg-[var(--primary-soft)]" : r.spreadBps !== null && r.spreadBps < 0 ? "bg-[var(--error-surface)]" : undefined}>
                  <TableCell className="font-medium">{r.carrierName}</TableCell>
                  <TableCell className="text-right"><Level bps={r.producerLevelBps} onMissing="— set" /></TableCell>
                  <TableCell className="text-right"><Level bps={r.agencyLevelBps} /></TableCell>
                  <TableCell className="text-right"><Level bps={r.spreadBps} /></TableCell>
                  <TableCell className="font-mono text-xs">{r.writingNumber ?? <span className="font-sans font-semibold text-[var(--warning-ink)]">— set</span>}</TableCell>
                  <TableCell>{r.appointments.length ? r.appointments.map((a) => <StatusChip key={a.state} tone={a.status === "appointed" ? "good" : a.status === "pending" ? "info" : "neutral"} className="mr-1">{a.state}{a.expiresOn ? ` · ${a.expiresOn}` : ""}</StatusChip>) : <span className="text-[var(--muted)]">None</span>}</TableCell>
                  <TableCell className="tabular-nums">{r.levelFrom ?? "—"}</TableCell>
                  {canEdit && <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => open(r)}>Edit</Button></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {editing && (
        <DetailPanel mode="split" title={editing.carrierName} subtitle="A change starts on its date; earlier rows are never edited." onClose={() => setEditing(null)}
          footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Close</Button><Button onClick={saveCarrier} disabled={busy || (!level.trim() && (!number.trim() || number.trim() === editing.writingNumber))}>{busy ? "Saving…" : "Save level and number"}</Button></div>}>
          <div className="grid gap-3 text-sm">
            <label className="grid gap-1 font-medium">Producer contract level (%)<input inputMode="decimal" placeholder={editing.producerLevelBps === null ? "e.g. 90" : `now ${editing.producerLevelBps / 100}`} className={toolbarControl} value={level} onChange={(e) => setLevel(e.target.value)} /></label>
            <label className="grid gap-1 font-medium">Writing number<input className={`${toolbarControl} font-mono`} value={number} onChange={(e) => setNumber(e.target.value)} /></label>
            <label className="grid gap-1 font-medium">Effective from<input type="date" className={toolbarControl} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            {problem && <p role="alert" className="rounded-md border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-2 text-[var(--error-ink)]">{problem}</p>}
            <hr className="border-border" />
            <p className="font-medium">Add or change an appointment</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1">State<input maxLength={2} placeholder="TX" className={`${toolbarControl} uppercase`} value={state} onChange={(e) => setState(e.target.value)} /></label>
              <label className="grid gap-1">Status<select className={toolbarControl} value={apptStatus} onChange={(e) => setApptStatus(e.target.value as typeof apptStatus)}><option value="appointed">Appointed</option><option value="pending">Pending</option><option value="terminated">Terminated</option></select></label>
              <label className="col-span-2 grid gap-1">Expires<input type="date" className={toolbarControl} value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
            </div>
            <div><Button variant="outline" onClick={saveAppointment} disabled={busy || state.trim().length !== 2}>Save appointment</Button></div>
          </div>
        </DetailPanel>
      )}
    </div>
  );
}

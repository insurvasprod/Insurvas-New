"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { Level } from "./money";
import { sendJson, useAgencyData } from "./use-agency-data";

/** A form field: the toolbar control, filling its grid cell so a narrow column never scrolls sideways. */
const field = `${toolbarControl} w-full min-w-0`;

type CarrierRow = {
  carrierId: string; carrierName: string; agencyLevelBps: number | null; producerLevelBps: number | null; levelFrom: string | null;
  spreadBps: number | null; writingNumber: string | null; numberFrom: string | null; appointments: Array<{ state: string; status: string; expiresOn: string | null }>;
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * AG-0.9 / AG-1.1 Carriers tab · one row per carrier: his level beside the agency's, the spread, his writing number,
 * his appointments, each with its date. A missing level or number is a prompt, never a default. Edit opens the
 * carrier's own page (foundation pass 2026-11-03; it was a side panel): a change starts on a date and never rewrites
 * an earlier one. Two producers can never hold one number.
 */
export function ProducerCarriersTab({ producerId, canEdit }: { producerId: string; canEdit: boolean }) {
  const { data, error, loading, refreshing, reload } = useAgencyData<{ schemaPending: boolean; rows: CarrierRow[] }>(`/api/app/agency/producers/${producerId}/carriers`);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(400, 45);
  const shown = paginate(data?.rows ?? [], page, pageSize);
  const edit = (carrierId: string) => `/app/producers/${producerId}/carrier/${carrierId}`;

  return (
    <TableCard toolbar={<DataToolbar actions={<RefreshButton onClick={reload} refreshing={refreshing} />} />} footer={data && !data.schemaPending && data.rows.length ? <Pager page={shown.current} total={data.rows.length} noun="carriers" pageSize={pageSize} onPage={setPage} /> : undefined}>
      {error ? <ErrorState detail={error} /> : loading || !data ? <SectionLoading rows={4} columns={7} label="Loading carriers" /> : data.schemaPending ? (
        <EmptyState title="Not switched on yet" hint="Levels and writing numbers appear once the agency database update is applied." />
      ) : data.rows.length === 0 ? (
        <EmptyState title="No carriers yet" hint="Add the agency's carrier contracts on the rate card first; each producer's level is set against them here." action={<Button asChild variant="outline"><Link href="/app/rate-card">Open the rate card</Link></Button>} />
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
              {canEdit && <TableHead className="text-right"><span className="sr-only">Edit</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.rows.map((r) => (
              <TableRow key={r.carrierId} className={r.spreadBps !== null && r.spreadBps < 0 ? "bg-[var(--error-surface)]" : undefined}>
                <TableCell className="font-medium">{canEdit ? <Link className="hover:underline" href={edit(r.carrierId)}>{r.carrierName}</Link> : r.carrierName}</TableCell>
                <TableCell className="text-right"><Level bps={r.producerLevelBps} onMissing="— set" /></TableCell>
                <TableCell className="text-right"><Level bps={r.agencyLevelBps} /></TableCell>
                <TableCell className="text-right"><Level bps={r.spreadBps} /></TableCell>
                <TableCell className="font-mono text-xs">{r.writingNumber ?? <span className="font-sans font-semibold text-[var(--warning-ink)]">— set</span>}</TableCell>
                <TableCell>{r.appointments.length ? r.appointments.map((a) => <StatusChip key={a.state} tone={a.status === "appointed" ? "good" : a.status === "pending" ? "info" : "neutral"} className="mr-1">{a.state}{a.expiresOn ? ` · ${a.expiresOn}` : ""}</StatusChip>) : <span className="text-[var(--muted)]">None</span>}</TableCell>
                <TableCell className="tabular-nums">{r.levelFrom ?? "—"}</TableCell>
                {canEdit && <TableCell className="text-right"><Button asChild size="sm" variant="outline"><Link href={edit(r.carrierId)}>Edit</Link></Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}

/**
 * One carrier on a producer's record, a page of its own (Home › Agency › Producers › a producer › a carrier; foundation pass
 * 2026-11-03, it was a side panel): his contract level and writing number from a date, and his appointments by
 * state. A change starts on its date; earlier rows are never edited. The owner and admins only.
 */
export function ProducerCarrierForm({ producerId, carrierId }: { producerId: string; carrierId: string }) {
  const router = useRouter();
  const { data, error, loading, reload } = useAgencyData<{ schemaPending: boolean; rows: CarrierRow[] }>(`/api/app/agency/producers/${producerId}/carriers`);
  const row = data?.rows.find((r) => r.carrierId === carrierId) ?? null;
  const [level, setLevel] = useState("");
  const [number, setNumber] = useState<string | null>(null);
  const [from, setFrom] = useState(today());
  const [state, setState] = useState("");
  const [apptStatus, setApptStatus] = useState<"appointed" | "pending" | "terminated">("appointed");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const back = `/app/producers/${producerId}?tab=carriers`;

  if (error) return <TableCard><ErrorState detail={error} /></TableCard>;
  if (loading || !data) return <TableCard><SectionLoading rows={5} columns={2} label="Loading the carrier" /></TableCard>;
  if (!row) return <TableCard><EmptyState title="That carrier is not on this producer's record" hint="Add the agency's contract with it on the rate card first." action={<Button asChild variant="outline"><Link href={back}>Back to Carriers</Link></Button>} /></TableCard>;
  const typed = number ?? row.writingNumber ?? "";

  async function saveCarrier() {
    if (!row) return;
    setBusy(true);
    setProblem(null);
    const { error: message } = await sendJson(`/api/app/agency/producers/${producerId}/carriers`, "PUT", {
      carrierId,
      levelPercent: level.trim() || null,
      writingNumber: typed.trim() && typed.trim() !== row.writingNumber ? typed.trim() : null,
      effectiveFrom: from,
    });
    setBusy(false);
    if (message) { setProblem(message); return; }
    notify.done(`${row.carrierName} saved from ${from}. Earlier policies keep the level they had.`);
    router.push(back);
  }

  async function saveAppointment() {
    if (!row || state.trim().length !== 2) return;
    setBusy(true);
    setProblem(null);
    const { error: message } = await sendJson(`/api/app/agency/producers/${producerId}/appointments`, "PUT", { carrierId, state: state.trim(), status: apptStatus, expiresOn: expires || null });
    setBusy(false);
    if (message) { setProblem(message); return; }
    notify.done(`${row.carrierName} appointment in ${state.trim().toUpperCase()} saved.`);
    setState(""); setExpires("");
    reload();
  }

  const levelOff = !level.trim() && (!typed.trim() || typed.trim() === row.writingNumber);
  const theirs = row.producerLevelBps === null ? "is not set yet" : `is ${row.producerLevelBps / 100}% from ${row.levelFrom ?? "—"}`;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <TableCard title="Level and writing number" description={`Agency level ${row.agencyLevelBps === null ? "not set" : `${row.agencyLevelBps / 100}%`}; theirs ${theirs}.`}
        footer={<div className="flex w-full justify-end gap-2"><Button asChild variant="outline"><Link href={back}>Cancel</Link></Button><Button onClick={saveCarrier} disabled={busy || levelOff}>{busy ? "Saving…" : "Save level and number"}</Button></div>}>
        <div className="grid gap-4 p-4 text-sm sm:grid-cols-2">
          <label className="grid gap-1 font-medium">Producer contract level (%)<input inputMode="decimal" placeholder={row.producerLevelBps === null ? "e.g. 90" : `now ${row.producerLevelBps / 100}`} className={field} value={level} onChange={(e) => setLevel(e.target.value)} /></label>
          <label className="grid gap-1 font-medium">Writing number<input className={`${field} font-mono`} value={typed} onChange={(e) => setNumber(e.target.value)} /></label>
          <label className="grid gap-1 font-medium">Effective from<input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          {problem && <p role="alert" className="text-[var(--error-ink)] sm:col-span-2">{problem}</p>}
        </div>
      </TableCard>
      <TableCard title="Appointments" description={row.appointments.length ? row.appointments.map((a) => `${a.state} ${a.status}${a.expiresOn ? ` to ${a.expiresOn}` : ""}`).join(" · ") : "None yet."}
        footer={<div className="flex w-full justify-end"><Button variant="outline" onClick={saveAppointment} disabled={busy || state.trim().length !== 2}>Save appointment</Button></div>}>
        <div className="grid gap-4 p-4 text-sm sm:grid-cols-3">
          <label className="grid gap-1 font-medium">State<input maxLength={2} placeholder="TX" className={`${field} uppercase`} value={state} onChange={(e) => setState(e.target.value)} /></label>
          <label className="grid gap-1 font-medium">Status<select className={field} value={apptStatus} onChange={(e) => setApptStatus(e.target.value as typeof apptStatus)}><option value="appointed">Appointed</option><option value="pending">Pending</option><option value="terminated">Terminated</option></select></label>
          <label className="grid gap-1 font-medium">Expires<input type="date" className={field} value={expires} onChange={(e) => setExpires(e.target.value)} /></label>
        </div>
      </TableCard>
    </div>
  );
}

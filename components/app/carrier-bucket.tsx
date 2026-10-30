"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { BUCKET_STATE_LABELS, type BucketRow, type BucketState } from "@/lib/ingestion/bucket";
import type { BucketView } from "@/lib/ingestion/bucketStore";
import { fileDay, fileSize, FILE_TYPE_LABELS, FILE_TYPES, type CarrierFileType } from "@/lib/ingestion/constants";
import { fileHref } from "@/lib/ingestion/trace";
import { notify } from "@/lib/notify";

type Ready = Extract<BucketView, { available: true }>;

const STATE_TONE: Record<BucketState, StatusTone> = { received: "good", reading: "info", failed: "danger" };
const typeLabel = (type: string | null) => (type && type in FILE_TYPE_LABELS ? FILE_TYPE_LABELS[type as CarrierFileType] : "Not known");
const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const stamp = (iso: string, zone: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone });
const CADENCE: Record<string, string> = { daily: "Every business day", weekly: "Weekly", monthly: "Monthly" };

/**
 * Carrier files › Bucket: LA-4.1's automated drop, one day at a time — the files the agency's
 * scripts dropped, as they were read — refreshed every 20 seconds while the page is open. Missing
 * files are the file monitor's (LA-4.19), judged from each carrier's cadence in Carrier rules.
 * "Check now" runs the pipeline by hand instead of waiting for the five-minute poll.
 */
export function CarrierBucket({ initial, tenantId, readOnly }: { initial: Ready; tenantId: string; readOnly: boolean }) {
  const [view, setView] = useState<Ready>(initial);
  const [date, setDate] = useState(initial.date);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("");
  const [carrier, setCarrier] = useState("");
  const [type, setType] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async (day: string, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/app/carrier-files/bucket?date=${day}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "The bucket could not be read.");
      setView(data as Ready);
    } catch (error) {
      if (!quiet) notify.block(error instanceof Error ? error.message : "The bucket could not be read.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // Live: new files appear on their own while the page is open and visible.
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load(date, true); }, 20_000);
    return () => window.clearInterval(timer);
  }, [date, load]);

  function goTo(day: string) {
    setDate(day);
    setPage(1);
    void load(day);
  }

  async function checkNow() {
    setBusy(true);
    try {
      const response = await fetch("/api/app/carrier-files/bucket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check_now" }) });
      const data = (await response.json().catch(() => ({}))) as { registered?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The bucket could not be checked.");
      notify.done(data.registered ? `Checked: ${data.registered} ${data.registered === 1 ? "file" : "files"} read.` : "Checked: nothing new in the bucket.");
      await load(date, true);
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "The bucket could not be checked.");
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return view.rows.filter((row) =>
      (!needle || `${row.agency} ${row.carrierName} ${row.file.filename}`.toLowerCase().includes(needle)) &&
      (!agency || row.agency.toLowerCase() === agency.toLowerCase()) &&
      (!carrier || row.carrierId === carrier) &&
      (!type || row.fileType === type) &&
      (!state || row.state === state));
  }, [view.rows, query, agency, carrier, type, state]);
  const pageSize = useFittingPageSize(480, 45);
  const { current, rows: shown } = paginate(rows, page, pageSize);
  const filtered = Boolean(query.trim() || agency || carrier || type || state);
  const clear = () => { setQuery(""); setAgency(""); setCarrier(""); setType(""); setState(""); setPage(1); };
  const dayAgencies = [...new Set(view.rows.map((row) => row.agency))].sort((a, b) => a.localeCompare(b));
  const dayCarriers = [...new Map(view.rows.filter((row) => row.carrierId).map((row) => [row.carrierId as string, row.carrierName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const folder = `carrier-files/${tenantId}/MM-DD-YYYY/<agency>/<carrier>/<Policies | Commissions | New Business>/`;

  return (
    <div className="flex flex-col gap-4">
      {view.missing.length > 0 && (
        <TableCard title="Missing files" description="From the file monitor: a carrier on a cadence in Carrier rules that sent nothing by its due day.">
          <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[200px]">Carrier</th>
                <th className="w-[170px]">Cadence</th>
                <th className="w-[130px]">Due</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {view.missing.map((item) => (
                <tr key={item.id}>
                  <td><span className="block whitespace-normal break-words font-semibold leading-snug text-foreground">{item.carrierName}</span></td>
                  <td>{CADENCE[item.cadence] ?? item.cadence}</td>
                  <td className="tabular-nums">{item.due ? fileDay(item.due) : "—"}</td>
                  <td><span className="block whitespace-normal break-words leading-snug">{item.reasoning}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}

      <TableCard
        toolbar={
          <DataToolbar actions={<>
            {filtered && <ClearFiltersButton onClick={clear} />}
            {!readOnly && <Button type="button" disabled={busy} onClick={() => void checkNow()}>{busy ? "Checking…" : "Check now"}</Button>}
            <RefreshButton onClick={() => void load(date)} refreshing={loading} />
          </>}>
            <span className="inline-flex items-center gap-1">
              <Button type="button" variant="outline" size="icon" aria-label="The day before" onClick={() => goTo(shiftDay(date, -1))}><ChevronLeft aria-hidden="true" /></Button>
              <input type="date" aria-label="Day" className={toolbarControl} value={date} onChange={(event) => { if (event.target.value) goTo(event.target.value); }} />
              <Button type="button" variant="outline" size="icon" aria-label="The day after" onClick={() => goTo(shiftDay(date, 1))}><ChevronRight aria-hidden="true" /></Button>
            </span>
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search agency, carrier or file" />
            <select aria-label="Filter by agency" className={toolbarControl} value={agency} onChange={(event) => { setAgency(event.target.value); setPage(1); }}>
              <option value="">All agencies</option>
              {dayAgencies.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select aria-label="Filter by carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
              <option value="">All carriers</option>
              {dayCarriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            <select aria-label="Filter by type" className={toolbarControl} value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}>
              <option value="">Every type</option>
              {FILE_TYPES.map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
            </select>
            <select aria-label="Filter by status" className={toolbarControl} value={state} onChange={(event) => { setState(event.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="received">Received</option>
              <option value="reading">Reading</option>
              <option value="failed">Can&apos;t be read</option>
            </select>
          </DataToolbar>
        }
        footer={view.rows.length ? <Pager page={current} pageSize={pageSize} total={rows.length} onPage={setPage} noun={rows.length === 1 ? "file" : "files"} suffix="new files are picked up every 5 minutes" /> : undefined}
      >
        {view.rows.length === 0 ? (
          <EmptyState
            title={`Nothing dropped into the bucket on ${fileDay(date)}`}
            hint={`Scripts drop files into ${folder}`}
            action={<Button type="button" variant="outline" onClick={() => { void navigator.clipboard.writeText(folder).then(() => notify.done("Folder copied."), () => notify.block("Copy it by hand: the browser refused.")); }}><Copy aria-hidden="true" />Copy the folder</Button>}
          />
        ) : rows.length === 0 ? (
          <NoMatches noun="files" onClear={clear} />
        ) : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[180px]">Agency</th>
                <th className="w-[200px]">Carrier</th>
                <th className="w-[130px]">Type</th>
                <th className="w-[150px]">Status</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => <BucketTableRow key={row.key} row={row} zone={view.timezone} />)}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}

function BucketTableRow({ row, zone }: { row: BucketRow; zone: string }) {
  const file = row.file;
  return (
    <tr>
      <td><span className="block whitespace-normal break-words font-semibold leading-snug text-foreground">{row.agency}</span></td>
      <td><span className="block whitespace-normal break-words leading-snug">{row.carrierName}</span></td>
      <td>{typeLabel(row.fileType)}</td>
      <td title={file.problem ?? undefined}>
        <StatusChip tone={STATE_TONE[row.state]}>{BUCKET_STATE_LABELS[row.state]}</StatusChip>
        {row.replaced > 0 && <span className="block text-xs text-muted-foreground">replaced {row.replaced} earlier {row.replaced === 1 ? "file" : "files"}</span>}
      </td>
      <td>
        <Link href={fileHref(file.id)} className="block max-w-[360px] truncate text-[var(--accent-ink)] hover:underline" title={file.path}>{file.filename}</Link>
        <span className="block text-xs text-muted-foreground">
          {fileSize(file.bytes)} · {stamp(file.receivedAt, zone)}{file.rows !== null ? ` · ${file.rows.toLocaleString("en-US")} ${file.rows === 1 ? "row" : "rows"}` : ""}
        </span>
        {file.problem && <span className="block max-w-[420px] truncate text-xs text-[var(--error-ink)]" title={file.problem}>{file.problem}</span>}
      </td>
    </tr>
  );
}

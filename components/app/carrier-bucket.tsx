"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy } from "lucide-react";

import { BUCKET_CHECKED_EVENT, bucketFolder, copyFolder } from "@/components/app/book/setup/files-in-bucket-actions";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { Button } from "@/components/ui/button";
import { ActiveFilters, DataToolbar, FilterButton, FilterField, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl, type ActiveFilter } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { BUCKET_STATE_LABELS, type BucketRow, type BucketState, type MissingFile } from "@/lib/ingestion/bucket";
import type { BucketView } from "@/lib/ingestion/bucketStore";
import { fileDay, fileSize, FILE_TYPE_LABELS, FILE_TYPES, type CarrierFileType } from "@/lib/ingestion/constants";
import type { CarrierChoice } from "@/lib/ingestion/path";
import { fileHref } from "@/lib/ingestion/trace";
import { notify } from "@/lib/notify";
import { load as loadResource, readResource } from "@/lib/client/resource-cache";

type Ready = Extract<BucketView, { available: true }>;
/** One day of the bucket, as the app's cache keys it (lib/client/resource-cache.ts). */
const bucketKey = (day: string) => `/api/app/carrier-files/bucket?date=${day}`;

const STATE_TONE: Record<BucketState, StatusTone> = { received: "good", reading: "info", failed: "danger" };
const typeLabel = (type: string | null) => (type && type in FILE_TYPE_LABELS ? FILE_TYPE_LABELS[type as CarrierFileType] : "Not known");
const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const stamp = (iso: string, zone: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone });
const CADENCE: Record<string, string> = { daily: "Every business day", weekly: "Weekly", monthly: "Monthly" };
const STATUS_OPTIONS: Array<[string, string]> = [["missing", "Missing"], ["received", "Received"], ["reading", "Reading"], ["failed", "Can't be read"]];

type Line = { kind: "missing"; item: MissingFile } | { kind: "file"; row: BucketRow };

/**
 * Carrier files › Bucket: LA-4.1's automated drop, one day at a time — the files the agency's scripts dropped, as
 * they were read — refreshed every 20 seconds while the page is open. Missing files are the file monitor's
 * (LA-4.19), judged from each carrier's cadence in Carrier terms.
 *
 * r7 4·2 (owner 2026-11-10): Files in's Bucket tab. The day is the toolbar's lead; the missing files are red rows at
 * the top of the same table (not a second table above), each with "Upload it ›" — the one upload dialog, preset to
 * its carrier. The four selects moved into the inline Filters panel (§6a). Check now and Copy the folder are on the
 * title line (files-in-bucket-actions.tsx); this table reads its day again once Check now is done.
 */
export function CarrierBucket({ initial, tenantId, carriers, readOnly }: { initial: Ready; tenantId: string; carriers: CarrierChoice[]; readOnly: boolean }) {
  const [view, setView] = useState<Ready>(initial);
  const [date, setDate] = useState(initial.date);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [agency, setAgency] = useState("");
  const [carrier, setCarrier] = useState("");
  const [type, setType] = useState("");
  const [state, setState] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  const load = useCallback(async (day: string, quiet = false, fresh = false) => {
    if (!quiet) setLoading(true);
    try {
      // Through the app's cache (lib/client/resource-cache.ts): a day read a moment ago is not asked again.
      const data = await (fresh ? loadResource<Ready>(bucketKey(day)) : readResource<Ready>(bucketKey(day)));
      setView(data);
    } catch (error) {
      if (!quiet) notify.block(error instanceof Error ? error.message : "The bucket could not be read.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // Live: new files appear on their own while the page is open and visible.
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load(date, true, true); }, 20_000);
    return () => window.clearInterval(timer);
  }, [date, load]);

  // Check now (on the title line) has read the bucket: read this day again.
  useEffect(() => {
    const again = () => void load(date, true, true);
    window.addEventListener(BUCKET_CHECKED_EVENT, again);
    return () => window.removeEventListener(BUCKET_CHECKED_EVENT, again);
  }, [date, load]);

  function goTo(day: string) {
    setDate(day);
    setPage(1);
    void load(day);
  }

  const lines = useMemo<Line[]>(() => {
    const needle = query.trim().toLowerCase();
    // A missing file has no agency or type of its own: an agency or type filter leaves it out.
    const missing = view.missing.filter((item) =>
      (!needle || item.carrierName.toLowerCase().includes(needle)) && !agency && !type && (!carrier || item.carrierId === carrier) && (!state || state === "missing"));
    const files = view.rows.filter((row) =>
      (!needle || `${row.agency} ${row.carrierName} ${row.file.filename}`.toLowerCase().includes(needle)) &&
      (!agency || row.agency.toLowerCase() === agency.toLowerCase()) &&
      (!carrier || row.carrierId === carrier) &&
      (!type || row.fileType === type) &&
      (!state || row.state === state));
    return [...missing.map((item) => ({ kind: "missing" as const, item })), ...files.map((row) => ({ kind: "file" as const, row }))];
  }, [view.rows, view.missing, query, agency, carrier, type, state]);
  const pageSize = useFittingPageSize(480, 45);
  const { current, rows: shown } = paginate(lines, page, pageSize);
  const clear = () => { setQuery(""); setAgency(""); setCarrier(""); setType(""); setState(""); setPage(1); };
  const dayAgencies = [...new Set(view.rows.map((row) => row.agency))].sort((a, b) => a.localeCompare(b));
  const dayCarriers = [...new Map([
    ...view.missing.map((item) => [item.carrierId, item.carrierName] as const),
    ...view.rows.filter((row) => row.carrierId).map((row) => [row.carrierId as string, row.carrierName] as const),
  ]).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const folder = bucketFolder(tenantId, date);
  const total = view.rows.length + view.missing.length;

  const set = (setter: (value: string) => void) => (value: string) => { setter(value); setPage(1); };
  const chips: ActiveFilter[] = [
    agency && { key: "agency", label: "Agency", value: agency, onRemove: () => set(setAgency)("") },
    carrier && { key: "carrier", label: "Carrier", value: dayCarriers.find(([id]) => id === carrier)?.[1] ?? "Carrier", onRemove: () => set(setCarrier)("") },
    type && { key: "type", label: "Type", value: typeLabel(type), onRemove: () => set(setType)("") },
    state && { key: "state", label: "Status", value: STATUS_OPTIONS.find(([key]) => key === state)?.[1] ?? state, onRemove: () => set(setState)("") },
  ].filter(Boolean) as ActiveFilter[];

  return (
    <>
      <TableCard
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => void load(date, false, true)} refreshing={loading} labelClassName="sr-only" />}>
            <span className="inline-flex items-center gap-1">
              <Button type="button" variant="outline" size="icon" aria-label="The day before" onClick={() => goTo(shiftDay(date, -1))}><ChevronLeft aria-hidden="true" /></Button>
              <input type="date" aria-label="Day" className={toolbarControl} value={date} onChange={(event) => { if (event.target.value) goTo(event.target.value); }} />
              <Button type="button" variant="outline" size="icon" aria-label="The day after" onClick={() => goTo(shiftDay(date, 1))}><ChevronRight aria-hidden="true" /></Button>
            </span>
            <ToolbarSearch value={query} onChange={set(setQuery)} placeholder="Search agency, carrier or file" />
            <FilterButton open={filtersOpen} count={chips.length} controls="bucket-filters" onClick={() => setFiltersOpen((now) => !now)} />
          </DataToolbar>
        }
        filters={<>
          <FilterPanel id="bucket-filters" open={filtersOpen}>
            <FilterField label="Agency" htmlFor="bucket-agency">
              <select id="bucket-agency" className={`${toolbarControl} w-full`} value={agency} onChange={(event) => set(setAgency)(event.target.value)}>
                <option value="">All agencies</option>
                {dayAgencies.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </FilterField>
            <FilterField label="Carrier" htmlFor="bucket-carrier">
              <select id="bucket-carrier" className={`${toolbarControl} w-full`} value={carrier} onChange={(event) => set(setCarrier)(event.target.value)}>
                <option value="">All carriers</option>
                {dayCarriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </FilterField>
            <FilterField label="Type" htmlFor="bucket-type">
              <select id="bucket-type" className={`${toolbarControl} w-full`} value={type} onChange={(event) => set(setType)(event.target.value)}>
                <option value="">Every type</option>
                {FILE_TYPES.map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
              </select>
            </FilterField>
            <FilterField label="Status" htmlFor="bucket-status">
              <select id="bucket-status" className={`${toolbarControl} w-full`} value={state} onChange={(event) => set(setState)(event.target.value)}>
                <option value="">All statuses</option>
                {STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </FilterField>
          </FilterPanel>
          <ActiveFilters filters={chips} onClear={clear} />
        </>}
        footer={total ? <Pager page={current} pageSize={pageSize} total={lines.length} onPage={setPage} noun={lines.length === 1 ? "file" : "files"} suffix="new files are picked up every 5 minutes" /> : undefined}
      >
        {total === 0 ? (
          <EmptyState
            title={`Nothing dropped into the bucket on ${fileDay(date)}`}
            hint={folder}
            action={<Button type="button" variant="outline" onClick={() => void copyFolder(folder)}><Copy aria-hidden="true" />Copy the folder</Button>}
          />
        ) : lines.length === 0 ? (
          <NoMatches noun="files" onClear={clear} />
        ) : (
          <>
            <table className="portal-lead-table hidden w-full min-w-[860px] text-left text-sm md:table">
              <thead>
                <tr>
                  <th className="w-[180px]">Agency</th>
                  <th className="w-[200px]">Carrier</th>
                  <th className="w-[130px]">Type</th>
                  <th className="w-[150px]">Status</th>
                  <th className="w-[170px]">Received</th>
                  <th>File</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((line) => line.kind === "missing"
                  ? <MissingTableRow key={`missing-${line.item.id}`} item={line.item} onUpload={readOnly ? null : () => setUploadFor(line.item.carrierId)} />
                  : <BucketTableRow key={line.row.key} row={line.row} zone={view.timezone} />)}
              </tbody>
            </table>
            {/* Phone (r7 4·5): a file is a card; the day stepper stays in the toolbar. */}
            <ul className="m-0 grid list-none gap-2 p-3 md:hidden" aria-label="Files">
              {shown.map((line) => line.kind === "missing" ? (
                <li key={`missing-${line.item.id}`} className="grid gap-1 rounded-lg border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium text-foreground">{line.item.carrierName}</span><StatusChip tone="danger">Missing</StatusChip></div>
                  <span className="text-xs text-muted-foreground">{missingFacts(line.item)}</span>
                  {!readOnly && <button type="button" className="justify-self-start text-sm hover:underline" onClick={() => setUploadFor(line.item.carrierId)}>Upload it ›</button>}
                </li>
              ) : (
                <li key={line.row.key} className="grid gap-1 rounded-lg border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium text-foreground">{line.row.carrierName} · {typeLabel(line.row.fileType)}</span><StatusChip tone={STATE_TONE[line.row.state]} title={line.row.file.problem ?? undefined}>{BUCKET_STATE_LABELS[line.row.state]}</StatusChip></div>
                  <Link href={fileHref(line.row.file.id)} className="break-all text-xs hover:underline">{line.row.file.filename}</Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </TableCard>
      {uploadFor !== null && (
        <CarrierFileUploadButton key={uploadFor} carriers={carriers} preset={{ carrierId: uploadFor }} open onOpenChange={(next) => { if (!next) { setUploadFor(null); void load(date, true, true); } }} />
      )}
    </>
  );
}

const missingFacts = (item: MissingFile) =>
  [CADENCE[item.cadence] ?? item.cadence, item.due ? `due ${fileDay(item.due)}` : null, item.lastReceivedAt ? `nothing dropped since ${fileDay(item.lastReceivedAt.slice(0, 10))}` : "nothing dropped yet"].filter(Boolean).join(" · ");

/**
 * A file the file monitor expected and never saw: at the top of the day, one line, its Missing chip the only colour.
 * When it was due and why it was expected are on hover; the way to send it is the File cell's "Upload it ›".
 */
function MissingTableRow({ item, onUpload }: { item: MissingFile; onUpload: (() => void) | null }) {
  const facts = [missingFacts(item), item.reasoning].filter(Boolean).join(" · ");
  return (
    <tr>
      <td className="text-muted-foreground">—</td>
      <td className="whitespace-nowrap">{item.carrierName}</td>
      <td className="whitespace-nowrap">Expected file</td>
      <td><StatusChip tone="danger" title={facts}>Missing</StatusChip></td>
      <td className="whitespace-nowrap tabular-nums text-muted-foreground" title={facts}>{item.due ? `due ${fileDay(item.due)}` : "—"}</td>
      <td className="whitespace-nowrap" title={facts}>
        {onUpload ? <button type="button" className="hover:underline" onClick={onUpload}>Upload it ›</button> : <span className="text-muted-foreground">—</span>}
      </td>
    </tr>
  );
}

function BucketTableRow({ row, zone }: { row: BucketRow; zone: string }) {
  const file = row.file;
  return (
    <tr>
      <td className="whitespace-nowrap font-medium text-foreground">{row.agency}</td>
      <td className="whitespace-nowrap">{row.carrierName}</td>
      <td className="whitespace-nowrap">{typeLabel(row.fileType)}</td>
      <td>
        <StatusChip tone={STATE_TONE[row.state]} title={[file.problem, row.replaced > 0 ? `Replaced ${row.replaced} earlier ${row.replaced === 1 ? "file" : "files"}` : null].filter(Boolean).join(" · ") || undefined}>{BUCKET_STATE_LABELS[row.state]}</StatusChip>
      </td>
      <td className="whitespace-nowrap tabular-nums text-muted-foreground">{stamp(file.receivedAt, zone)}</td>
      <td className="whitespace-nowrap">
        <Link href={fileHref(file.id)} className="hover:underline" title={`${file.path} · ${fileSize(file.bytes)}${file.rows !== null ? ` · ${file.rows.toLocaleString("en-US")} ${file.rows === 1 ? "row" : "rows"}` : ""}`}>{file.filename}</Link>
      </td>
    </tr>
  );
}

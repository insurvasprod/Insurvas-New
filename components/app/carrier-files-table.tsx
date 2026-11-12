"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { ClearFiltersButton, DataToolbar, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { notify } from "@/lib/notify";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { StageStrip } from "@/components/app/book/files/stage-strip";
import {
  FILE_SOURCE_LABELS,
  FILE_STATUS_LABELS,
  FILE_TYPE_LABELS,
  fileDay,
  fileSize,
  type CarrierFileSource,
  type CarrierFileStatus,
  type CarrierFileType,
} from "@/lib/ingestion/constants";
import { fileWhere, type FileStageView } from "@/lib/ingestion/fileStages";
import { fileHref } from "@/lib/ingestion/trace";
import type { CarrierFileRow } from "@/lib/ingestion/registry";

const STATUS_TONE: Record<CarrierFileStatus, StatusTone> = {
  received: "info",
  parsing: "info",
  parsed: "good",
  failed: "danger",
  superseded: "neutral",
};


const PERIODS = { all: "Any time", "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" } as const;
/** While a file is being read: ask again this often, for at most this long, and light a finished row this long. */
const LIVE_EVERY_MS = 3000;
const LIVE_FOR_MS = 5 * 60_000;
const LIT_FOR_MS = 4000;

/**
 * LA-4.1 (Notion sprint) · every carrier file the agency holds, however it arrived. A failed file
 * stays on the list with the reason; a replaced one stays too, marked as replaced, with its original
 * still downloadable. Nothing here is ever deleted.
 *
 * Round 2 (owner 2026-11-02): each file shows its eight stages as a strip and where it is ("3 need you ·
 * Linked", "Read failed", "Done"), and opens its page. `stages` comes from the server (fileOutcomeStore);
 * without it the old status chip shows.
 *
 * Round 3 (owner 2026-11-02): the Files step's chips (All · Needs you · Failed · Missing) sit on top as
 * `chips` and pick `show` by the address, so the old stage select is gone. The toolbar is one row
 * (search, carrier, type; how it arrived and when sit under "More filters").
 *
 * One line per row (owner 2026-11-11): File · Carrier · Type · Date · Stages · Where it is. The row opens the
 * file's page (Download is there); the row count and a failed file's reason are tooltips.
 */
/**
 * A file's problem in a few words for its row: the part before the explanation ("Totals don't add up:
 * the lines sum to $0.00…" → "Totals don't add up"), else its first sentence. The whole text stays in
 * the tooltip and on the file's page.
 */
function shortReason(text: string): string {
  const head = text.split(/:\s/)[0].split(/\.\s/)[0].replace(/\.$/, "").trim();
  return head.length > 60 ? `${head.slice(0, 57).trimEnd()}…` : head;
}

export function CarrierFilesTable({ files, stages, emptyTitle, emptyHint, show, chips, also }: { files: CarrierFileRow[]; stages?: Record<string, FileStageView>; emptyTitle: string; emptyHint: string; show?: "needs" | "failed"; chips?: ReactNode; /** What the chip counts beside the files, said in the footer (walk 2026-11-03: "Needs you 21" over "12 files"). */ also?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [type, setType] = useState<"all" | CarrierFileType>("all");
  const where = show ?? "all";
  const [source, setSource] = useState<"all" | CarrierFileSource>("all");
  const [period, setPeriod] = useState<keyof typeof PERIODS>("all");
  const [page, setPage] = useState(1);
  // "Last N days" counts back from when the list was opened.
  const [openedAt] = useState(() => Date.now());
  // What sits above the rows at 1440x900: the header, the figures, the chips, the toolbar and the column heads.
  const pageSize = useFittingPageSize(540, 45);

  const whereOf = (file: CarrierFileRow) => fileWhere(file, stages?.[file.id]);

  // Live (owner 2026-11-05: "updated automatically, not to click refresh … see when the reading has been done or
  // failed"). While a file is still being read the list asks the server again every few seconds, and stops once
  // nothing is moving (or after a few minutes, so a stuck file never polls for ever). A file that finishes while
  // the list is open says so in a toast and its row lights up for a moment.
  const reading = useMemo(() => files.filter((file) => whereOf(file) === "running"), // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, stages]);
  const [lit, setLit] = useState<Record<string, true>>({});
  const seen = useRef<Map<string, string> | null>(null);
  const pollingSince = useRef<number | null>(null);
  useEffect(() => {
    if (!reading.length) { pollingSince.current = null; return; }
    pollingSince.current ??= Date.now();
    if (Date.now() - pollingSince.current > LIVE_FOR_MS) return;
    const timer = window.setTimeout(() => router.refresh(), LIVE_EVERY_MS);
    return () => window.clearTimeout(timer);
  }, [reading, router, files]);
  useEffect(() => {
    const now = new Map(files.map((file) => [file.id, whereOf(file)]));
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    const finished = files.filter((file) => before.get(file.id) === "running" && now.get(file.id) !== "running");
    if (!finished.length) return;
    for (const file of finished) {
      const where = now.get(file.id);
      const label = stages?.[file.id]?.where.label;
      if (where === "failed") notify.warn(`${file.originalFilename} could not be read`, { detail: file.errorDetail ? shortReason(file.errorDetail) : label });
      else if (where === "needs") notify.arrive(`${file.originalFilename} is read`, { detail: label ?? "Some rows need you." });
      else notify.done(`${file.originalFilename} is read`, { detail: label && label !== "Done" ? label : file.rowCount !== null ? `${file.rowCount.toLocaleString("en-US")} ${file.rowCount === 1 ? "row" : "rows"}` : undefined });
    }
    setLit((current) => ({ ...current, ...Object.fromEntries(finished.map((file) => [file.id, true as const])) }));
    const timer = window.setTimeout(() => setLit((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !finished.some((file) => file.id === id)))), LIT_FOR_MS);
    return () => window.clearTimeout(timer);
    // whereOf reads `stages`, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, stages]);

  const carriers = useMemo(() => [...new Set(files.map((file) => file.carrierName).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b)), [files]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const since = period === "all" ? null : openedAt - Number(period) * 86_400_000;
    return files.filter((file) =>
      (!needle || `${file.originalFilename} ${file.carrierName ?? ""} ${file.agency ?? ""} ${file.emailFrom ?? ""} ${file.uploadedByName ?? ""}`.toLowerCase().includes(needle)) &&
      (!carrier || file.carrierName === carrier) &&
      (type === "all" || file.fileType === type) &&
      (where === "all" || whereOf(file) === where) &&
      (source === "all" || file.source === source) &&
      (since === null || new Date(file.receivedAt).getTime() >= since),
    );
    // whereOf reads `stages`, listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, stages, query, carrier, type, where, source, period, openedAt]);
  const { current, rows } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim() || carrier || type !== "all" || source !== "all" || period !== "all");
  const clear = () => { setQuery(""); setCarrier(""); setType("all"); setSource("all"); setPeriod("all"); setPage(1); };

  return (
    <TableCard
      className="flex min-h-[calc(100dvh-var(--top-bar-h)-332px)] flex-col [&>.overflow-x-auto]:flex-1"
      toolbar={<div className="flex w-full flex-col gap-3">
        {chips}
        <DataToolbar actions={<>
          {filtered && <ClearFiltersButton onClick={clear} />}
          {/* No Refresh button: the list keeps itself current while anything is being read (owner 2026-11-05). */}
          <span role="status" aria-live="polite" className="inline-flex items-center gap-2 text-sm text-foreground">
            {reading.length ? (
              <><span aria-hidden="true" className="size-2 rounded-full bg-[var(--primary)] motion-safe:animate-pulse" />Reading {reading.length === 1 ? "1 file" : `${reading.length} files`}…</>
            ) : (
              <><span aria-hidden="true" className="size-2 rounded-full bg-[var(--border-strong)]" />Up to date</>
            )}
          </span>
        </>}>
          <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="File, carrier or sender" className="sm:w-52" />
          <select aria-label="Filter files by carrier" className={`${toolbarControl} w-[150px]`} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
            <option value="">Every carrier</option>
            {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select aria-label="Filter files by type" className={toolbarControl} value={type} onChange={(event) => { setType(event.target.value as typeof type); setPage(1); }}>
            <option value="all">Every type</option>
            {(Object.keys(FILE_TYPE_LABELS) as CarrierFileType[]).map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
          </select>
          {/* Every filter on the one row (owner 2026-11-02), no "More filters" panel under it. */}
          <select aria-label="How it arrived" className={toolbarControl} value={source} onChange={(event) => { setSource(event.target.value as typeof source); setPage(1); }}>
            <option value="all">Every door</option>
            {(Object.keys(FILE_SOURCE_LABELS) as CarrierFileSource[]).map((key) => <option key={key} value={key}>{FILE_SOURCE_LABELS[key]}</option>)}
          </select>
          <select aria-label="When it arrived" className={toolbarControl} value={period} onChange={(event) => { setPeriod(event.target.value as keyof typeof PERIODS); setPage(1); }}>
            {(Object.keys(PERIODS) as Array<keyof typeof PERIODS>).map((key) => <option key={key} value={key}>{PERIODS[key]}</option>)}
          </select>
        </DataToolbar>
      </div>}
      footer={files.length ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "file" : "files"} suffix={also ? `newest first · ${also}` : "newest first"} /> : undefined}
    >
      {files.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : visible.length === 0 ? (
        <NoMatches noun="files" onClear={clear} />
      ) : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>File</th>
              <th>Carrier</th>
              <th>Type</th>
              <th>Date</th>
              <th>Stages</th>
              <th>Where it is</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {/* One line per row (owner 2026-11-11): the file name first, plain values, the one chip says where it is.
                The row count, size, door and sender are the name's tooltip; a failed file's reason is the chip's. The
                whole row opens the file's page, where Download sits. */}
            {rows.map((file) => {
              const from = file.source === "upload" ? file.uploadedByName ?? "A former member" : file.source === "email" ? file.emailFrom ?? "Unknown sender" : file.agency ?? "A script";
              const view = stages?.[file.id];
              const reason = file.status === "failed" ? file.errorDetail : file.rawError;
              const rowsWord = file.rowCount !== null ? ` · ${file.rowCount.toLocaleString("en-US")} ${file.rowCount === 1 ? "row" : "rows"}` : "";
              return (
                <tr key={file.id} className={`m-row cursor-pointer transition-colors duration-700 ${lit[file.id] ? "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)]" : ""}`} onClick={() => router.push(fileHref(file.id))}>
                  <td className="whitespace-nowrap font-medium text-foreground">
                    <Link href={fileHref(file.id)} className="hover:underline" onClick={(event) => event.stopPropagation()} title={`${file.originalFilename}${rowsWord} · ${fileSize(file.fileBytes)} · ${FILE_SOURCE_LABELS[file.source]} · ${from}`}>{file.originalFilename}</Link>
                  </td>
                  <td className="whitespace-nowrap">{file.carrierName ?? <span className="text-muted-foreground" title="No carrier yet">—</span>}</td>
                  <td className="whitespace-nowrap">{file.fileType ? FILE_TYPE_LABELS[file.fileType] : <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground" title={`Arrived ${fileDay(file.receivedAt)} · ${FILE_SOURCE_LABELS[file.source]} · ${from}`}>{fileDay(file.fileDate)}</td>
                  <td>{view ? <StageStrip stages={view.stages} fileType={file.fileType} reading={whereOf(file) === "running"} /> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap">
                    {view ? (
                      <StatusChip tone={view.where.tone} title={reason ?? undefined}>{view.where.label}</StatusChip>
                    ) : (
                      <StatusChip tone={STATUS_TONE[file.status]} title={reason ?? undefined}>{file.status === "parsed" && file.parserVersion ? `${FILE_STATUS_LABELS.parsed} · v${file.parserVersion}` : FILE_STATUS_LABELS[file.status]}</StatusChip>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

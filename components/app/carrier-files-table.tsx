"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/app/book-of-business-views";
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
import type { FileStageView } from "@/lib/ingestion/fileStages";
import { fileHref } from "@/lib/ingestion/trace";
import type { CarrierFileRow } from "@/lib/ingestion/registry";

const STATUS_TONE: Record<CarrierFileStatus, StatusTone> = {
  received: "info",
  parsing: "info",
  parsed: "good",
  failed: "danger",
  superseded: "neutral",
};

type Where = "all" | "needs" | "failed" | "waiting" | "running" | "done" | "replaced";
const WHERE_LABELS: Record<Exclude<Where, "all">, string> = {
  needs: "Needs you",
  failed: "Failed",
  waiting: "Waiting for a layout",
  running: "Still going",
  done: "Done",
  replaced: "Replaced",
};

const PERIODS = { all: "Any time", "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" } as const;

/**
 * LA-4.1 (Notion sprint) · every carrier file the agency holds, however it arrived. A failed file
 * stays on the list with the reason; a replaced one stays too, marked as replaced, with its original
 * still downloadable. Nothing here is ever deleted.
 *
 * Round 2 (owner 2026-11-02): each file shows its eight stages as a strip and where it is ("3 need you ·
 * Linked", "Read failed", "Done"), and opens its page. `stages` comes from the server (fileOutcomeStore);
 * without it the old status chip shows.
 */
export function CarrierFilesTable({ files, stages, emptyTitle, emptyHint }: { files: CarrierFileRow[]; stages?: Record<string, FileStageView>; emptyTitle: string; emptyHint: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [type, setType] = useState<"all" | CarrierFileType>("all");
  const [where, setWhere] = useState<Where>("all");
  const [source, setSource] = useState<"all" | CarrierFileSource>("all");
  const [period, setPeriod] = useState<keyof typeof PERIODS>("all");
  const [page, setPage] = useState(1);
  // "Last N days" counts back from when the list was opened.
  const [openedAt] = useState(() => Date.now());
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pageSize = useFittingPageSize(420, 49);

  const whereOf = (file: CarrierFileRow): Exclude<Where, "all"> => {
    if (file.status === "superseded") return "replaced";
    if (file.waitingForLayout) return "waiting";
    const view = stages?.[file.id];
    if (view?.stages.some((s) => s.state === "failed") || file.status === "failed") return "failed";
    if (view?.stages.some((s) => s.state === "needs")) return "needs";
    if (view?.stages.some((s) => s.state === "pending") || file.status === "received" || file.status === "parsing") return "running";
    return "done";
  };

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
  const filtered = Boolean(query.trim() || carrier || type !== "all" || where !== "all" || source !== "all" || period !== "all");
  const clear = () => { setQuery(""); setCarrier(""); setType("all"); setWhere("all"); setSource("all"); setPeriod("all"); setPage(1); };

  async function download(id: string) {
    setOpening(id);
    setProblem(null);
    try {
      const response = await fetch(`/api/app/carrier-files/${id}/file`);
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? "The file could not be opened.");
      window.location.assign(data.url);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : "The file could not be opened.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <TableCard
      className="flex min-h-[calc(100dvh-var(--top-bar-h)-332px)] flex-col [&>.overflow-x-auto]:flex-1"
      toolbar={
        <DataToolbar actions={<>
          {filtered && <ClearFiltersButton onClick={clear} />}
          <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="File, carrier or sender" />
          <select aria-label="Filter files by carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
            <option value="">Every carrier</option>
            {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select aria-label="Filter files by type" className={toolbarControl} value={type} onChange={(event) => { setType(event.target.value as typeof type); setPage(1); }}>
            <option value="all">Policies and commissions</option>
            {(Object.keys(FILE_TYPE_LABELS) as CarrierFileType[]).map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
          </select>
          <select aria-label="Filter files by where they are" className={toolbarControl} value={where} onChange={(event) => { setWhere(event.target.value as Where); setPage(1); }}>
            <option value="all">Any stage</option>
            {(Object.keys(WHERE_LABELS) as Array<Exclude<Where, "all">>).map((key) => <option key={key} value={key}>{WHERE_LABELS[key]}</option>)}
          </select>
          <select aria-label="Filter files by how they arrived" className={toolbarControl} value={source} onChange={(event) => { setSource(event.target.value as typeof source); setPage(1); }}>
            <option value="all">Every door</option>
            {(Object.keys(FILE_SOURCE_LABELS) as CarrierFileSource[]).map((key) => <option key={key} value={key}>{FILE_SOURCE_LABELS[key]}</option>)}
          </select>
          <select aria-label="Filter files by when they arrived" className={toolbarControl} value={period} onChange={(event) => { setPeriod(event.target.value as keyof typeof PERIODS); setPage(1); }}>
            {(Object.keys(PERIODS) as Array<keyof typeof PERIODS>).map((key) => <option key={key} value={key}>{PERIODS[key]}</option>)}
          </select>
        </DataToolbar>
      }
      footer={files.length ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? "file" : "files"} suffix="newest first" /> : undefined}
    >
      {problem && <p role="alert" className="border-b border-border bg-[var(--error-surface)] px-4 py-2 text-sm text-[var(--error-ink)]">{problem}</p>}
      {files.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : visible.length === 0 ? (
        <NoMatches noun="files" onClear={clear} />
      ) : (
        <table className="portal-lead-table w-full min-w-[1040px] text-left text-sm">
          <thead>
            <tr>
              <th className="w-[96px]">Date</th>
              <th className="w-[150px]">Carrier</th>
              <th className="w-[104px]">Type</th>
              <th>File</th>
              <th className="w-[64px] text-right">Rows</th>
              <th className="w-[184px]">Stages</th>
              <th className="w-[180px]">Where it is</th>
              <th className="w-[176px] text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((file) => {
              const from = file.source === "upload" ? file.uploadedByName ?? "A former member" : file.source === "email" ? file.emailFrom ?? "Unknown sender" : file.agency ?? "A script";
              const view = stages?.[file.id];
              return (
                <tr key={file.id} className="m-row">
                  <td className="tabular-nums" title={`Arrived ${fileDay(file.receivedAt)} · ${FILE_SOURCE_LABELS[file.source]} · ${from}`}>{fileDay(file.fileDate)}</td>
                  <td>{file.carrierName ? <span className="block whitespace-normal break-words font-semibold leading-snug text-foreground">{file.carrierName}</span> : <span className="text-muted-foreground">No carrier yet</span>}</td>
                  <td>{file.fileType ? FILE_TYPE_LABELS[file.fileType] : <span className="text-muted-foreground">—</span>}</td>
                  <td>
                    <Link href={fileHref(file.id)} className="block max-w-[240px] truncate text-foreground hover:underline" title={`${file.originalFilename} · ${fileSize(file.fileBytes)} · ${FILE_SOURCE_LABELS[file.source]} · ${from}`}>{file.originalFilename}</Link>
                    {file.status === "failed" && file.errorDetail && <span className={`block max-w-[240px] truncate text-xs ${file.waitingForLayout ? "text-muted-foreground" : "text-[var(--error-ink)]"}`} title={file.errorDetail}>{file.errorDetail}</span>}
                    {file.status !== "failed" && file.rawError && <span className="block max-w-[240px] truncate text-xs text-[var(--error-ink)]" title={file.rawError}>{file.rawError}</span>}
                  </td>
                  <td
                    className="text-right tabular-nums"
                    title={file.rowCount !== null ? "Rows kept exactly as they arrived" : file.fileKind === "pdf" ? "A PDF is read with its carrier's PDF layout once one is published" : file.rawError ?? (file.status === "failed" ? undefined : "Waiting to be read")}
                  >
                    {file.rowCount !== null ? file.rowCount.toLocaleString("en-US") : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td>{view ? <StageStrip stages={view.stages} /> : <span className="text-muted-foreground">—</span>}</td>
                  <td>
                    {view ? (
                      <StatusChip tone={view.where.tone}>{view.where.label}</StatusChip>
                    ) : (
                      <StatusChip tone={STATUS_TONE[file.status]}>{file.status === "parsed" && file.parserVersion ? `${FILE_STATUS_LABELS.parsed} · v${file.parserVersion}` : FILE_STATUS_LABELS[file.status]}</StatusChip>
                    )}
                  </td>
                  <td className="text-right">
                    <span className="inline-flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={opening === file.id} onClick={() => void download(file.id)}>
                        {opening === file.id ? "Opening…" : "Download"}
                      </Button>
                      <Button asChild size="sm" variant="outline"><Link href={fileHref(file.id)} aria-label={`Open ${file.originalFilename}`}>Open</Link></Button>
                    </span>
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

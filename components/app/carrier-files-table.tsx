"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/app/book-of-business-views";
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
import type { CarrierFileRow } from "@/lib/ingestion/registry";

const STATUS_TONE: Record<CarrierFileStatus, StatusTone> = {
  received: "info",
  parsing: "info",
  parsed: "good",
  failed: "danger",
  superseded: "neutral",
};

/**
 * LA-4.1 (Notion sprint) · every carrier file the agency holds, however it arrived. A failed file
 * stays on the list with the reason; a replaced one stays too, marked as replaced, with its original
 * still downloadable. Nothing here is ever deleted.
 */
export function CarrierFilesTable({ files, emptyTitle, emptyHint }: { files: CarrierFileRow[]; emptyTitle: string; emptyHint: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [carrier, setCarrier] = useState("");
  const [type, setType] = useState<"all" | CarrierFileType>("all");
  const [status, setStatus] = useState<"all" | CarrierFileStatus>("all");
  const [source, setSource] = useState<"all" | CarrierFileSource>("all");
  const [page, setPage] = useState(1);
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pageSize = useFittingPageSize(420, 49);

  const carriers = useMemo(() => [...new Set(files.map((file) => file.carrierName).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b)), [files]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return files.filter((file) =>
      (!needle || `${file.originalFilename} ${file.carrierName ?? ""} ${file.agency ?? ""} ${file.emailFrom ?? ""} ${file.uploadedByName ?? ""}`.toLowerCase().includes(needle)) &&
      (!carrier || file.carrierName === carrier) &&
      (type === "all" || file.fileType === type) &&
      (status === "all" || file.status === status) &&
      (source === "all" || file.source === source),
    );
  }, [files, query, carrier, type, status, source]);
  const { current, rows } = paginate(visible, page, pageSize);
  const filtered = Boolean(query.trim() || carrier || type !== "all" || status !== "all" || source !== "all");
  const clear = () => { setQuery(""); setCarrier(""); setType("all"); setStatus("all"); setSource("all"); setPage(1); };

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
      className="flex min-h-[calc(100dvh-var(--top-bar-h)-300px)] flex-col [&>.overflow-x-auto]:flex-1"
      toolbar={
        <DataToolbar actions={<>
          {filtered && <ClearFiltersButton onClick={clear} />}
          <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search files" />
          <select aria-label="Filter files by carrier" className={toolbarControl} value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
            <option value="">All carriers</option>
            {carriers.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <select aria-label="Filter files by type" className={toolbarControl} value={type} onChange={(event) => { setType(event.target.value as typeof type); setPage(1); }}>
            <option value="all">All types</option>
            {(Object.keys(FILE_TYPE_LABELS) as CarrierFileType[]).map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
          </select>
          <select aria-label="Filter files by status" className={toolbarControl} value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}>
            <option value="all">All statuses</option>
            {(Object.keys(FILE_STATUS_LABELS) as CarrierFileStatus[]).map((key) => <option key={key} value={key}>{FILE_STATUS_LABELS[key]}</option>)}
          </select>
          <select aria-label="Filter files by how they arrived" className={toolbarControl} value={source} onChange={(event) => { setSource(event.target.value as typeof source); setPage(1); }}>
            <option value="all">Every door</option>
            {(Object.keys(FILE_SOURCE_LABELS) as CarrierFileSource[]).map((key) => <option key={key} value={key}>{FILE_SOURCE_LABELS[key]}</option>)}
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
        <table className="portal-lead-table w-full min-w-[1180px] text-left text-sm">
          <thead>
            <tr>
              <th className="w-[120px]">File date</th>
              <th>Carrier</th>
              <th className="w-[120px]">Type</th>
              <th>File</th>
              <th className="w-[170px]">Arrived</th>
              <th className="w-[120px]">Received</th>
              <th className="w-[80px] text-right">Size</th>
              <th className="w-[80px] text-right">Rows</th>
              <th className="w-[170px]">Status</th>
              <th className="w-[110px] text-right"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((file) => {
              const from = file.source === "upload" ? file.uploadedByName ?? "A former member" : file.source === "email" ? file.emailFrom ?? "Unknown sender" : file.agency ?? "A script";
              return (
                <tr key={file.id} className="m-row">
                  <td className="tabular-nums">{fileDay(file.fileDate)}</td>
                  <td className="max-w-[200px] truncate font-semibold text-foreground" title={file.carrierName ?? "Carrier not known"}>{file.carrierName ?? <span className="font-normal text-muted-foreground">Not known</span>}</td>
                  <td>{file.fileType ? FILE_TYPE_LABELS[file.fileType] : <span className="text-muted-foreground">Not known</span>}</td>
                  <td className="max-w-[300px]">
                    <span className="block truncate text-foreground" title={file.originalFilename}>{file.originalFilename}</span>
                    {file.status === "failed" && file.errorDetail && <span className={`block truncate text-xs ${file.waitingForLayout ? "text-muted-foreground" : "text-[var(--error-ink)]"}`} title={file.errorDetail}>{file.errorDetail}</span>}
                    {file.status !== "failed" && file.rawError && <span className="block truncate text-xs text-[var(--error-ink)]" title={file.rawError}>{file.rawError}</span>}
                  </td>
                  <td className="max-w-[170px] truncate" title={`${FILE_SOURCE_LABELS[file.source]} · ${from}`}>
                    <span className="block truncate">{FILE_SOURCE_LABELS[file.source]}</span>
                    <span className="block truncate text-xs text-muted-foreground">{from}</span>
                  </td>
                  <td className="tabular-nums">{fileDay(file.receivedAt)}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{fileSize(file.fileBytes)}</td>
                  <td
                    className="text-right tabular-nums"
                    title={file.rowCount !== null ? "Rows kept exactly as they arrived" : file.fileKind === "pdf" ? "A PDF's lines are read by PDF extraction" : file.rawError ?? (file.status === "failed" ? undefined : "Waiting to be read")}
                  >
                    {file.rowCount !== null ? file.rowCount.toLocaleString("en-US") : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td>
                    {file.waitingForLayout ? (
                      <StatusChip tone="info">Waiting for a layout</StatusChip>
                    ) : (
                      <StatusChip tone={STATUS_TONE[file.status]}>{file.status === "parsed" && file.parserVersion ? `${FILE_STATUS_LABELS.parsed} · v${file.parserVersion}` : FILE_STATUS_LABELS[file.status]}</StatusChip>
                    )}
                  </td>
                  <td className="text-right">
                    <Button type="button" variant="outline" size="sm" disabled={opening === file.id} onClick={() => void download(file.id)}>
                      {opening === file.id ? "Opening…" : "Download"}
                    </Button>
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

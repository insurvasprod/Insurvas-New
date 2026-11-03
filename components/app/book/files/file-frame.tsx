import type { ReactNode } from "react";
import Link from "next/link";

import { DataInPage } from "@/components/app/data-in/data-in-page";
import { CarrierFileDownload } from "@/components/app/carrier-file-download";
import { CarrierFileReread } from "@/components/app/carrier-file-reread";
import { CarrierFileUploadButton } from "@/components/app/carrier-file-upload";
import { StatusChip } from "@/components/ui/status-chip";
import { ViewTabs } from "@/components/ui/view-tabs";
import { FILE_SOURCE_LABELS, FILE_TYPE_LABELS, fileDay, type CarrierFileSource, type CarrierFileType } from "@/lib/ingestion/constants";
import type { FileHead } from "@/lib/ingestion/fileOutcomeStore";
import { libraryCarriers } from "@/lib/ingestion/registry";
import { fileHref } from "@/lib/ingestion/trace";

export type FileTab = "overview" | "rows" | "changes" | "commissions" | "whole";

const time = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });

/**
 * Book of business › Files › a file (round 2, owner 2026-11-02): the detail page's frame. The trail and
 * the file's name; then its status chip and one line of facts (arrived, layout, rows, what it replaces,
 * the previous file); Download, Replace with a corrected file and Read again on the right; then the tabs
 * Overview · Rows · Changes · Commissions · Whole file. Every tab of the file renders inside this.
 */
export async function FileFrame({ head, tab, counts, readOnly, children }: {
  head: FileHead;
  tab: FileTab;
  counts?: { rows?: number | null; changes?: number | null };
  readOnly: boolean;
  children: ReactNode;
}) {
  const base = fileHref(head.id);
  const failed = head.status === "failed";
  const facts: Array<[string, ReactNode]> = [
    ["Arrived", `${time(head.receivedAt)} · ${FILE_SOURCE_LABELS[head.source as CarrierFileSource] ?? head.source}${head.emailFrom ? ` from ${head.emailFrom}` : ""}`],
    ["Layout", head.map ? `${head.map.name} v${head.map.version}` : "None yet"],
    ["Rows", head.rowCount === null ? "Not read yet" : `${head.rowCount.toLocaleString("en-US")} ${head.parsedRows !== null ? "read" : "kept"}${head.heldRows ? ` · ${head.heldRows.toLocaleString("en-US")} held` : ""}`],
    ["Replaces", head.replaces ? <Link href={fileHref(head.replaces.id)} className="text-[var(--accent-ink)] hover:underline">{head.replaces.name}</Link> : "nothing"],
    ...(head.supersededBy ? [["Replaced by", <Link key="by" href={fileHref(head.supersededBy.id)} className="text-[var(--accent-ink)] hover:underline">{head.supersededBy.name}</Link>] as [string, ReactNode]] : []),
    ["Previous file", head.previous ? <Link href={fileHref(head.previous.id)} className="text-[var(--accent-ink)] hover:underline">{fileDay(head.previous.fileDate)} ›</Link> : "none"],
  ];
  const what = [head.fileType ? FILE_TYPE_LABELS[head.fileType as CarrierFileType] : "Type not known", head.carrierName ?? "No carrier yet", fileDay(head.fileDate)].join(" · ");

  // The carrier library (cached a minute) for the corrected file's pop-up.
  const carriers = !readOnly && head.carrierId && head.fileType ? await libraryCarriers() : [];
  const replace = !readOnly && head.carrierId && head.fileType ? (
    <CarrierFileUploadButton
      carriers={carriers}
      openWhenDone
      label="Replace with a corrected file"
      variant={failed ? "default" : "outline"}
      title="Upload the carrier's corrected file for the same day: it replaces this one, which stays listed"
      preset={{ carrierId: head.carrierId, fileType: head.fileType as CarrierFileType, fileDate: head.fileDate, agency: head.agency }}
    />
  ) : null;

  return (
    <DataInPage
      step="files"
      title={head.name}
      actions={<>
        <CarrierFileDownload fileId={head.id} label="Download" />
        {replace}
        {head.rowCount !== null && !readOnly && <CarrierFileReread fileId={head.id} />}
      </>}
      lead={
        <div className="flex w-full min-w-0 flex-col gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
            <StatusChip tone={head.where.tone}>{head.where.label}</StatusChip>
            <span>{what}</span>
            {facts.map(([term, value]) => <span key={term} className="min-w-0">{term} <span className="font-semibold text-foreground">{value}</span></span>)}
          </div>
          <ViewTabs
            label="This file"
            value={tab}
            tabs={[
              { key: "overview", label: "Overview", href: base },
              { key: "rows", label: "Rows", count: counts?.rows ?? head.rowCount, href: `${base}?tab=rows` },
              { key: "changes", label: "Changes", count: counts?.changes ?? null, href: `${base}?tab=changes` },
              { key: "commissions", label: "Commissions", href: `${base}?tab=commissions` },
              { key: "whole", label: "Whole file", href: `${base}/whole` },
            ]}
          />
        </div>
      }
    >
      {children}
    </DataInPage>
  );
}

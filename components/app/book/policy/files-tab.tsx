import Link from "next/link";

import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { fileDay } from "@/lib/ingestion/constants";
import type { PolicyFile } from "@/lib/ingestion/policyPageStore";
import { fileHref, rowHref } from "@/lib/ingestion/trace";

import { ClickRow } from "./click-row";

/** Policy › Files: every carrier file that mentioned this policy, newest first; the whole row opens its file (board 10), its row numbers open their row. */
export function PolicyFilesTab({ files }: { files: PolicyFile[] }) {
  return (
    <PagedTableCard total={files.length} noun="files">
      {files.length === 0 ? (
        <EmptyState title="No file has mentioned this policy yet" hint="Each carrier policy file and commission statement that names it shows here." />
      ) : (
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th className="w-[120px]">File date</th><th>File</th><th className="w-[140px]">Kind</th><th>Rows</th><th className="w-8"><span className="sr-only">Open</span></th></tr></thead>
          <PagedBody>
            {files.map((file) => (
              <ClickRow key={file.fileId} href={fileHref(file.fileId)} label={`Open ${file.name}`}>
                <td className="tabular-nums text-muted-foreground">{fileDay(file.date)}</td>
                <td className="max-w-[360px] truncate font-medium text-foreground" title={file.name}>{file.name}</td>
                {/* Round 6 (board 6): the kind as a chip, so policy files and statements part at a glance. */}
                <td><StatusChip tone={file.kind === "commissions" ? "info" : "neutral"}>{file.kind === "commissions" ? "Commission statement" : "Policy file"}</StatusChip></td>
                <td className="text-muted-foreground">
                  {file.rowNumbers.length === 0 ? "—" : file.rowNumbers.slice(0, 4).map((n, index) => (
                    <span key={n}>{index > 0 ? ", " : ""}<Link href={rowHref(file.fileId, n)} className="text-[var(--accent-ink)] hover:underline">{file.kind === "commissions" ? "line" : "row"} {n}</Link></span>
                  ))}
                  {file.rowNumbers.length > 4 ? ` and ${file.rowNumbers.length - 4} more` : ""}
                </td>
              </ClickRow>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}

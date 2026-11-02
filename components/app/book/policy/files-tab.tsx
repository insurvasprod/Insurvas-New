import Link from "next/link";

import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { fileDay } from "@/lib/ingestion/constants";
import type { PolicyFile } from "@/lib/ingestion/policyPageStore";
import { fileHref, rowHref } from "@/lib/ingestion/trace";

/** Policy › Files: every carrier file that mentioned this policy, newest first; each opens its file, its rows open their row. */
export function PolicyFilesTab({ files }: { files: PolicyFile[] }) {
  return (
    <PagedTableCard total={files.length} noun="files">
      {files.length === 0 ? (
        <EmptyState title="No file has mentioned this policy yet" hint="Each carrier policy file and commission statement that names it shows here." />
      ) : (
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th className="w-[120px]">File date</th><th>File</th><th className="w-[140px]">Kind</th><th>Rows</th></tr></thead>
          <PagedBody>
            {files.map((file) => (
              <tr key={file.fileId}>
                <td className="tabular-nums text-muted-foreground">{fileDay(file.date)}</td>
                <td className="max-w-[360px] truncate"><Link href={fileHref(file.fileId)} className="font-medium text-foreground hover:underline" title={file.name}>{file.name}</Link></td>
                <td className="text-muted-foreground">{file.kind === "commissions" ? "Commission statement" : "Policy file"}</td>
                <td className="text-muted-foreground">
                  {file.rowNumbers.length === 0 ? "—" : file.rowNumbers.slice(0, 4).map((n, index) => (
                    <span key={n}>{index > 0 ? ", " : ""}<Link href={rowHref(file.fileId, n)} className="text-[var(--accent-ink)] hover:underline">{file.kind === "commissions" ? "line" : "row"} {n}</Link></span>
                  ))}
                  {file.rowNumbers.length > 4 ? ` and ${file.rowNumbers.length - 4} more` : ""}
                </td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}

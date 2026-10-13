import Link from "next/link";
import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FILE_STATUS_LABELS, fileDay, type CarrierFileStatus } from "@/lib/ingestion/constants";
import { isRecordUuid } from "@/lib/ingestion/path";
import { rowHref } from "@/lib/ingestion/trace";
import { pdfBalanceReview } from "@/lib/ingestion/rawLayer";
import { loadFileTrace } from "@/lib/ingestion/traceStore";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";
import { CarrierFileDownload } from "@/components/app/carrier-file-download";
import { CarrierFileReread } from "@/components/app/carrier-file-reread";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PdfBalanceReview } from "@/components/app/pdf-balance-review";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Carrier files › one file (LA-4.20, Notion sprint): what it is — carrier, date, type, how it arrived,
 * its hash, the layout map and version that read it — every row as it arrived, each opening the raw
 * row and what it produced, and the original itself. Owner and bookkeeper. Opening it writes nothing.
 */
const SOURCE = { upload: "Uploaded", email: "Emailed in", bucket: "Dropped by a script" } as Record<string, string>;
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export default async function CarrierFilePage({ params, searchParams }: { params: Promise<{ fileId: string }>; searchParams: Promise<{ page?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!hasTenantPermission(guard.role, "statements.view")) return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files, and the rows in them, are opened by the account owner or a bookkeeper." />;
  const { fileId } = await params;
  if (!isRecordUuid(fileId)) notFound();
  const { page } = await searchParams;
  const file = await loadFileTrace(guard.context.tenantId, fileId, Number(page) || 1);
  if (!file) notFound();
  // LA-4.4: a PDF statement the balance gate refused, read again for review (writes nothing).
  const balance = file.fileKind === "pdf" && file.status === "failed" ? await pdfBalanceReview(guard.context.tenantId, file.id) : null;

  const facts: Array<[string, string]> = [
    ["Carrier", file.carrierName ?? "Not known"],
    ["File date", fileDay(file.fileDate)],
    ["Type", file.fileType === "policies" ? "Policy file" : file.fileType === "commissions" ? "Commission file" : file.fileType === "new_business" ? "New business file" : "Not known"],
    ["Arrived", `${SOURCE[file.source] ?? file.source}, ${fileDay(file.receivedAt.slice(0, 10))}`],
    ["Format", `${(file.fileKind ?? "").toUpperCase() || "—"} · ${size(file.bytes)}`],
    ["Status", (FILE_STATUS_LABELS[file.status as CarrierFileStatus] ?? file.status) + (file.supersededBy ? " (a corrected file replaced it)" : "")],
    ["Read with", file.map ? `${file.map.name}, version ${file.map.version}` : "No layout map yet"],
    ["Rows", file.rowCount === null ? "Not read yet" : `${file.rowCount.toLocaleString("en-US")} kept as they arrived${file.parsedRows !== null ? ` · ${file.parsedRows.toLocaleString("en-US")} read` : ""}${file.heldRows ? ` · ${file.heldRows} held` : ""}`],
    ["Content hash (SHA-256)", file.contentHash],
  ];

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title={file.name} description="One carrier file, exactly as it arrived: each row opens what it became." actions={<>{file.rowCount !== null && guard.entitlement.access !== "read_only" && <CarrierFileReread fileId={file.id} />}<CarrierFileDownload fileId={file.id} /></>} />
      <TableCard>
        <dl className="grid gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-3">
          {facts.map(([term, value]) => (
            <div key={term} className="min-w-0"><dt className="text-xs text-muted-foreground">{term}</dt><dd className={`m-0 truncate font-medium text-foreground ${term.startsWith("Content hash") ? "font-mono text-xs" : ""}`} title={value}>{value}</dd></div>
          ))}
        </dl>
        {file.errorDetail && <p className="m-0 border-t border-border px-4 py-3 text-sm text-[var(--warning-ink)]">{file.errorDetail}</p>}
      </TableCard>

      {balance && <PdfBalanceReview check={balance} />}

      <TableCard
        title="Rows"
        footer={file.pages > 1 ? (
          <span className="flex w-full items-center justify-between">
            <span>Page {file.page} of {file.pages}</span>
            <span className="flex gap-3">
              {file.page > 1 && <Link className="font-semibold text-[var(--accent-ink)] hover:underline" href={`?page=${file.page - 1}`}>Previous</Link>}
              {file.page < file.pages && <Link className="font-semibold text-[var(--accent-ink)] hover:underline" href={`?page=${file.page + 1}`}>Next</Link>}
            </span>
          </span>
        ) : undefined}
      >
        {file.rows.length === 0 ? <EmptyState title="No rows kept" hint={file.fileKind === "pdf" ? "A PDF is read with its carrier's PDF layout: its rows are kept once one is published." : "The rows are kept once the file is read."} /> : (
          <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
            <thead><tr><th className="w-[80px] text-right">Row</th>{file.headers.map((h) => <th key={h}>{h}</th>)}<th>Became</th></tr></thead>
            <tbody>
              {file.rows.map((r) => (
                <tr key={r.rowNumber}>
                  <td className="text-right tabular-nums"><Link href={rowHref(file.id, r.rowNumber)} className="font-semibold text-[var(--accent-ink)] hover:underline">{r.rowNumber}</Link></td>
                  {r.preview.map((v, i) => <td key={i} className="max-w-[200px] truncate font-mono text-xs" title={v}>{v}</td>)}
                  <td className="text-xs">{r.produced ?? <span className="text-muted-foreground">Nothing (held, or not read)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FILE_STATUS_LABELS, fileDay, type CarrierFileStatus, type CarrierFileType } from "@/lib/ingestion/constants";
import { clearlyBetter } from "@/lib/ingestion/fileCheck";
import { checkCarrierFile } from "@/lib/ingestion/fileCheckStore";
import { isRecordUuid } from "@/lib/ingestion/path";
import { libraryCarriers } from "@/lib/ingestion/registry";
import { fileHref, rowHref } from "@/lib/ingestion/trace";
import { pdfBalanceReview } from "@/lib/ingestion/rawLayer";
import { loadFileTrace } from "@/lib/ingestion/traceStore";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";
import { CarrierFileAttribute } from "@/components/app/carrier-file-attribute";
import { CarrierFileDownload } from "@/components/app/carrier-file-download";
import { CarrierFileReread } from "@/components/app/carrier-file-reread";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { PdfBalanceReview } from "@/components/app/pdf-balance-review";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
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
  // Owner request 2026-10-14 · the file checker. Notion LA-4.1 attributes automatic files by path
  // without opening them, so the checker only SUGGESTS: for a file that came in without a carrier,
  // a person CONFIRMS who sent it ("Who sent this?"); for a file whose layout missed a required
  // column, one line says which other layout its columns match. Read-only.
  const needsCarrier = file.status === "failed" && !file.carrierId;
  const missedColumn = file.status === "failed" && Boolean(file.carrierId) && /required column/i.test(file.errorDetail ?? "");
  const [check, carriers] = await Promise.all([
    needsCarrier || missedColumn ? checkCarrierFile(guard.context.tenantId, file.id).catch(() => null) : null,
    needsCarrier ? libraryCarriers() : [],
  ]);
  const better = missedColumn && check ? clearlyBetter(check, check.currentLayoutKey) : null;
  const wholeHref = `${fileHref(file.id)}/whole`;

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
      <PageHeader title={file.name} description="One carrier file, exactly as it arrived: each row opens what it became." actions={<>{file.rowCount !== null && guard.entitlement.access !== "read_only" && <CarrierFileReread fileId={file.id} />}<Button asChild variant="outline"><Link href={wholeHref}>Whole file</Link></Button><CarrierFileDownload fileId={file.id} /></>} />
      <TableCard>
        <dl className="grid gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-3">
          {facts.map(([term, value]) => (
            <div key={term} className="min-w-0"><dt className="text-xs text-muted-foreground">{term}</dt><dd className={`m-0 truncate font-medium text-foreground ${term.startsWith("Content hash") ? "font-mono text-xs" : ""}`} title={value}>{value}</dd></div>
          ))}
        </dl>
        {file.errorDetail && <p className="m-0 border-t border-border px-4 py-3 text-sm text-[var(--warning-ink)]">{file.errorDetail}</p>}
        {better && <p className="m-0 border-t border-border px-4 py-3 text-sm text-foreground">These columns match {better.name}{better.carriers.length ? ` (used by ${better.carriers.map((carrier) => carrier.name).join(", ")})` : ""}. Check the file&apos;s carrier and type.</p>}
      </TableCard>

      {needsCarrier && (
        <CarrierFileAttribute
          fileId={file.id}
          readOnly={guard.entitlement.access === "read_only"}
          carriers={carriers}
          suggestions={(check?.matches ?? []).map((match) => ({ layoutKey: match.layoutKey, layoutName: match.name, fileType: match.fileType, carriers: match.carriers, carrierId: match.carrierId, fit: match.fit, matched: match.matched, total: match.total, missingRequired: match.missingRequired, pdfRows: match.pdfRows }))}
          initial={{
            carrierId: check?.matches[0]?.carrierId ?? check?.fromName.carrierId ?? null,
            fileType: check?.matches[0]?.fileType ?? check?.fromName.fileType ?? (file.fileType as CarrierFileType | null) ?? null,
            fileDate: file.fileDate ?? check?.fromName.fileDate ?? null,
          }}
        />
      )}

      {balance && <PdfBalanceReview check={balance} />}

      <TableCard
        title="Rows"
        description={file.rowCount ? `As the carrier sent them: all ${file.columnCount} ${file.columnCount === 1 ? "column" : "columns"}, scroll sideways for more. The whole file, title lines and every sheet too, is one click away.` : "The whole file, every sheet and line, is one click away."}
        action={<Button asChild variant="outline" size="sm"><Link href={wholeHref}>See the whole file</Link></Button>}
        footer={file.rowCount ? <Pager page={file.page} pageSize={file.pageSize} total={file.rowCount} noun="rows" pageHref="?" /> : undefined}
      >
        {file.rows.length === 0 ? <EmptyState title="No rows kept" hint={file.fileKind === "pdf" ? "A PDF is read with its carrier's PDF layout: its rows are kept once one is published." : "The rows are kept once the file is read."} /> : (
          <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-[2] w-[76px] bg-[var(--surface-alt)] text-right">Row</th>
                {file.headers.map((h) => <th key={h} className="max-w-[180px] truncate" title={h}>{h}</th>)}
                <th className="w-[200px]">Became</th>
              </tr>
            </thead>
            <tbody>
              {file.rows.map((r) => (
                <tr key={r.rowNumber} className="group">
                  <td className="sticky left-0 z-[1] bg-[var(--surface)] text-right group-hover:bg-[var(--surface-alt)]">
                    <Link href={rowHref(file.id, r.rowNumber)} className="inline-flex h-7 min-w-9 items-center justify-center rounded-full border border-border px-2 text-xs font-semibold tabular-nums text-[var(--accent-ink)] hover:border-[var(--border-strong)] hover:bg-[var(--primary-soft)]" aria-label={`Open row ${r.rowNumber}`}>{r.rowNumber}</Link>
                  </td>
                  {r.preview.map((v, i) => <td key={i} className="max-w-[180px] truncate font-mono text-xs" title={v}>{v === "" ? <span className="font-sans text-muted-foreground">—</span> : v}</td>)}
                  <td className="text-xs">
                    {r.produced
                      ? <StatusChip tone={r.produced.startsWith("Policy") ? "good" : "info"}>{r.produced}</StatusChip>
                      : <StatusChip tone="neutral">Held, or not read</StatusChip>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}

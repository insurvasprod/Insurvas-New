import Link from "next/link";
import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { fileDay } from "@/lib/ingestion/constants";
import { isRecordUuid } from "@/lib/ingestion/path";
import { fileHref } from "@/lib/ingestion/trace";
import { loadRowTrace } from "@/lib/ingestion/traceStore";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";
import { CarrierFileDownload } from "@/components/app/carrier-file-download";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";

/**
 * Carrier files › one raw row (LA-4.20, Notion sprint): every original column, the layout map
 * version that read it and the field each column became, and what the row produced — the policy
 * snapshot, or the commission lines. The screen that answers "did we parse this right?" without a
 * database client. Owner and bookkeeper. Opening it writes nothing.
 */
const cents = (n: number) => `${n < 0 ? "−" : ""}$${(Math.abs(n) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function RawRowPage({ params }: { params: Promise<{ fileId: string; rowNumber: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Carrier files" description="Bring in every policy and commission file your carriers send, however it arrives." />;
  if (!hasTenantPermission(guard.role, "statements.view")) return <RoleGateNotice featureLabel="Carrier files" detail="Carrier files, and the rows in them, are opened by the account owner or a bookkeeper." />;
  const { fileId, rowNumber } = await params;
  const n = Number(rowNumber);
  if (!isRecordUuid(fileId) || !Number.isInteger(n) || n < 1) notFound();
  const row = await loadRowTrace(guard.context.tenantId, fileId, n);
  if (!row) notFound();
  const policyHref = row.snapshot ? `/app/policies/carrier/${row.snapshot.carrierId}/${encodeURIComponent(row.snapshot.policyNumber)}` : null;

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title={`Row ${row.rowNumber}${row.rowCount ? ` of ${row.rowCount.toLocaleString("en-US")}` : ""}`}
        description={`${row.file.carrierName ?? "Carrier not known"} · ${row.file.name} · file of ${fileDay(row.file.fileDate)}`}
        actions={<><Link href={fileHref(row.file.id)} className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm font-semibold hover:bg-[var(--surface-alt)]">The whole file</Link><CarrierFileDownload fileId={row.file.id} /></>}
      />

      <TableCard title="What it became">
        <div className="grid gap-2 px-4 pb-4 text-sm">
          {row.snapshot ? (
            <p className="m-0">
              Policy <Link href={policyHref!} className="font-semibold text-[var(--accent-ink)] hover:underline">{row.snapshot.policyNumber}</Link>, as of {fileDay(row.snapshot.snapshotDate)}{" "}
              {row.snapshot.isCurrent ? <StatusChip tone="good">The policy&apos;s current values come from this row</StatusChip> : row.snapshot.superseded ? <StatusChip tone="neutral">Replaced by a corrected file</StatusChip> : <StatusChip tone="neutral">An earlier file: a newer one holds the current values</StatusChip>}
            </p>
          ) : null}
          {row.lines.map((l) => (
            <p key={l.id} className="m-0">
              Commission line: {l.type.replaceAll("_", " ")} <span className="font-semibold tabular-nums">{cents(l.amountCents)}</span> on <Link href={`/app/policies/carrier/${l.carrierId}/${encodeURIComponent(l.policyNumber)}`} className="text-[var(--accent-ink)] hover:underline">{l.policyNumber}</Link>
              {l.statementDate ? `, statement of ${fileDay(l.statementDate)}` : ""}{l.transactionDate ? `, dated ${fileDay(l.transactionDate)}` : ""}
            </p>
          ))}
          {!row.snapshot && row.lines.length === 0 && <p className="m-0 text-muted-foreground">Nothing: the row was held (an unmapped status or an unreadable value), or the file hasn&apos;t been read yet.</p>}
          <p className="m-0 text-xs text-muted-foreground">Read with {row.map ? `${row.map.name}, version ${row.map.version}` : "no layout map yet"}.</p>
        </div>
      </TableCard>

      <TableCard title="Every column, as the carrier sent it">
        <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
          <thead><tr><th className="w-[70px]">Column</th><th>Header</th><th>Value as sent</th><th>Became</th><th>Stored as</th></tr></thead>
          <tbody>
            {row.columns.map((c) => (
              <tr key={c.column + c.header}>
                <td className="font-mono text-xs text-muted-foreground">{c.column}</td>
                <td className="font-mono text-xs text-foreground">{c.header}</td>
                <td className="max-w-[260px] truncate font-mono text-xs" title={c.value}>{c.value === "" ? <span className="text-muted-foreground">(empty)</span> : c.value}</td>
                <td className="text-xs">{c.becameField ? <><span className="font-semibold text-foreground">{c.becameField}</span>{c.dataType ? <span className="text-muted-foreground"> · {c.dataType}{c.transform && c.transform !== "none" ? `, ${c.transform}` : ""}{c.required ? ", required" : ""}</span> : null}</> : <span className="text-muted-foreground">Not read by the map{row.snapshot ? "; kept with the snapshot" : ""}</span>}</td>
                <td className="max-w-[200px] truncate font-mono text-xs" title={c.stored ?? undefined}>{c.stored ?? (c.becameField?.startsWith("insured_") ? <span className="font-sans text-muted-foreground">Used to match the client, not kept on the policy</span> : <span className="text-muted-foreground">—</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {row.missingFields.length > 0 && (
          <p className="m-0 border-t border-border px-4 py-3 text-xs text-[var(--warning-ink)]">
            The map also reads {row.missingFields.map((f) => `${f.targetField} from “${f.sourceColumn}”`).join(", ")}, and this file has no such column.
          </p>
        )}
      </TableCard>
    </div>
  );
}

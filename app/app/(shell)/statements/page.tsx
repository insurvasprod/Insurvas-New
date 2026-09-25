import Link from "next/link";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { StatementImportButton } from "@/components/app/statement-import";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import {
  STATEMENT_SCHEMA_PENDING_MESSAGE,
  statementDay,
  statementMoney,
  statementPeriod,
  type StatementCarrierOption,
  type StatementMapping,
  type StatementStatus,
} from "@/lib/ledger/statementConstants";
import { getSavedStatementMappings, listStatementCarriers, listStatements } from "@/lib/ledger/statementService";
import { sectionForPath } from "@/lib/menu/definition";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › Statements: every carrier statement imported, newest first, with the import.
 *
 * A statement is a record, not a draft: it is never deleted, only voided with a reason, and each
 * row links to the review screen where its lines are accepted, matched by hand or left unmatched.
 * Owner and bookkeeper only (`statements.view`), the same two roles the API admits.
 */

const STATUS: Record<StatementStatus, { label: string; chip: string }> = {
  review: { label: "Waiting for review", chip: "bg-[var(--soft-orange-surface)] text-[var(--accent-ink)]" },
  reviewed: { label: "Reviewed", chip: "bg-[var(--success-surface)] text-[var(--success-ink)]" },
  voided: { label: "Voided", chip: "bg-[var(--surface-alt)] text-[var(--body)]" },
};

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Statements"
        eyebrow={sectionForPath("/app/statements") ?? undefined}
        description="Import carrier commission statements, match each line to a policy, and post accepted lines to the commission ledger."
      />
    );
  }
  if (!hasTenantPermission(guard.role, "statements.view")) {
    return <RoleGateNotice featureLabel="Statements" eyebrow={sectionForPath("/app/statements") ?? undefined} detail="Carrier statements are imported and reviewed by the account owner or a bookkeeper. Accepted lines for your policies appear on the commission ledger." />;
  }

  const readOnly = guard.entitlement.access === "read_only";
  const [{ available, statements }, { import: importParam }] = await Promise.all([listStatements(guard.context.tenantId), searchParams]);
  const blocked = !available ? STATEMENT_SCHEMA_PENDING_MESSAGE : readOnly ? "Importing is paused while the account is read-only." : null;
  const [carriers, savedMappings]: [StatementCarrierOption[], Record<string, StatementMapping>] = blocked
    ? [[], {}]
    : await Promise.all([listStatementCarriers(), getSavedStatementMappings(guard.context.tenantId)]);
  const importControl = blocked ? (
    <Button type="button" variant="outline" className="h-11 border-[var(--border-strong)] px-4" disabled title={blocked}>Import statement</Button>
  ) : (
    <StatementImportButton carriers={carriers} savedMappings={savedMappings} autoOpen={importParam === "1"} />
  );

  const standing = statements.filter((statement) => statement.status !== "voided");
  const waiting = standing.reduce((total, statement) => total + statement.counts.proposed + statement.counts.unmatched, 0);

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        eyebrow={sectionForPath("/app/statements") ?? undefined}
        title="Statements"
        description="Carrier commission statements, every line kept as the carrier sent it. A line posts to the commission ledger only when a person accepts its match."
        actions={<>
          <Button asChild type="button" variant="ghost" className="h-11 px-4"><Link href="/app/ledger">Commission ledger</Link></Button>
          {importControl}
        </>}
      />

      {blocked && (
        <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
          <p className="font-semibold text-[var(--warning-ink)]">Import statement is disabled, and says why</p>
          <p className="mt-1.5 text-[var(--body)]">&ldquo;{blocked}&rdquo;</p>
        </div>
      )}

      <TableCard
        title="Imported statements"
        description={statements.length ? `${standing.length.toLocaleString("en-US")} standing · ${waiting.toLocaleString("en-US")} ${waiting === 1 ? "line" : "lines"} waiting for a person` : undefined}
        footer={statements.length ? <><span>{statements.length.toLocaleString("en-US")} {statements.length === 1 ? "statement" : "statements"} · newest first</span><span>Statements are voided, never deleted</span></> : undefined}
      >
        {statements.length === 0 ? (
          <EmptyState
            title={available ? "No statement imported yet" : "Statements are not available yet"}
            hint={available
              ? "Import a carrier's commission statement as CSV. Each line is matched to your book by policy number and carrier, and posts to the ledger only when someone accepts the match."
              : STATEMENT_SCHEMA_PENDING_MESSAGE}
          />
        ) : (
          <table className="portal-lead-table w-full min-w-[1000px] text-left text-sm">
            <thead>
              <tr>
                <th>Statement</th>
                <th className="w-[150px]">Imported</th>
                <th className="w-[80px] text-right">Lines</th>
                <th className="w-[90px] text-right">Accepted</th>
                <th className="w-[90px] text-right">Waiting</th>
                <th className="w-[130px] text-right">Accepted amount</th>
                <th className="w-[170px]">Status</th>
                <th className="w-[90px]"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {statements.map((statement) => (
                <tr key={statement.id} className="m-row">
                  <td>
                    <span className="block font-semibold text-foreground">{statement.carrierName} · {statementPeriod(statement.periodStart, statement.periodEnd)}</span>
                    <span className="block text-xs text-muted-foreground">{statement.fileName}</span>
                  </td>
                  <td>
                    <span className="block tabular-nums">{statementDay(statement.uploadedAt)}</span>
                    <span className="block text-xs text-muted-foreground">{statement.uploadedByName ?? "A former member"}</span>
                  </td>
                  <td className="text-right tabular-nums">{statement.counts.lines.toLocaleString("en-US")}</td>
                  <td className="text-right tabular-nums">{statement.counts.accepted.toLocaleString("en-US")}</td>
                  <td className="text-right tabular-nums">{statement.status === "voided" ? "—" : (statement.counts.proposed + statement.counts.unmatched).toLocaleString("en-US")}</td>
                  <td className="text-right font-semibold tabular-nums">{statementMoney(statement.acceptedCents)}</td>
                  <td>
                    <span className={`inline-flex rounded-full px-2.5 py-[3px] text-xs font-semibold ${STATUS[statement.status].chip}`}>{STATUS[statement.status].label}</span>
                    {statement.counts.errors > 0 && <span className="mt-0.5 block text-xs text-muted-foreground">{statement.counts.errors.toLocaleString("en-US")} could not be read</span>}
                  </td>
                  <td className="text-right">
                    <Link href={`/app/statements/${statement.id}`} className="text-sm font-semibold text-foreground underline-offset-2 hover:underline">
                      {statement.status === "review" ? "Review" : "Open"}
                    </Link>
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { StatementFileButton, StatementManualEntry } from "@/components/app/statement-manual-entry";
import { StatementReview } from "@/components/app/statement-review";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { STATEMENT_SCHEMA_PENDING_MESSAGE, isRecordId, statementDay, statementMoney, statementPeriod } from "@/lib/ledger/statementConstants";
import { getStatementDetail } from "@/lib/ledger/statementService";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * One carrier statement, and the review that posts its lines. The header says where the file came
 * from and who brought it in; the table below is where every ledger entry gets the name of the
 * person who accepted it.
 *
 * LA-4.1: the original file opens from the header when it was kept. LA-4.2: a PDF statement waits
 * for its lines, and this page is where they are typed in, beside the PDF. LA-4.3: a statement read
 * from a stored CSV or workbook can be re-processed; one that was says which statement it replaced.
 */
export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Statements" description="Import carrier commission statements, match each line to a policy, and post accepted lines to the commission ledger." />;
  }
  if (!hasTenantPermission(guard.role, "statements.view")) {
    return <RoleGateNotice featureLabel="Statements" detail="Carrier statements are imported and reviewed by the account owner or a bookkeeper." />;
  }

  const { id } = await params;
  if (!isRecordId(id)) notFound();
  const { available, detail } = await getStatementDetail(guard.context.tenantId, id);
  // A detail page keeps one back link above its title instead of a breadcrumb or a header button.
  const back = (
    <Link href="/app/statements" className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-muted-foreground transition-colors hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden="true" />
      Statements
    </Link>
  );

  if (!available) {
    return (
      <div className="m-stagger flex flex-col gap-6">
        {back}
        <PageHeader title="Statement" />
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">
          {STATEMENT_SCHEMA_PENDING_MESSAGE}
        </div>
      </div>
    );
  }
  if (!detail) notFound();

  const { statement, lines, policies, carrier } = detail;
  const readOnly = guard.entitlement.access === "read_only";
  const voided = statement.status === "voided";
  const awaitingEntry = statement.status === "awaiting_entry";
  const waiting = statement.counts.proposed + statement.counts.unmatched;
  const kindLabel = statement.fileKind === "pdf" ? "PDF" : statement.fileKind === "xlsx" ? `Excel${statement.sheetName ? `, sheet “${statement.sheetName}”` : ""}` : "CSV";
  const canReprocess = statement.hasFile && statement.fileKind !== "pdf" && statement.headers.length > 0 && !voided;

  return (
    <div className="m-stagger flex flex-col gap-6">
      {back}
      <PageHeader
        title={`${statement.carrierName} · ${statementPeriod(statement.periodStart, statement.periodEnd)}`}
        description={`${statement.fileName} · ${kindLabel} · imported ${statementDay(statement.uploadedAt)}${statement.uploadedByName ? ` by ${statement.uploadedByName}` : ""} · ${awaitingEntry ? "lines not entered yet" : `${statement.rowCount.toLocaleString("en-US")} ${statement.rowCount === 1 ? "line" : "lines"}`}`}
        actions={statement.hasFile ? <StatementFileButton statementId={statement.id} /> : undefined}
      />

      {statement.reprocessedFrom && (
        <p role="status" className="text-sm text-muted-foreground">
          Re-processed from the stored file of an earlier import, which is voided and kept: <Link className="font-semibold text-foreground underline-offset-2 hover:underline" href={`/app/statements/${statement.reprocessedFrom}`}>open the earlier import</Link>.
        </p>
      )}

      {voided && (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">
          <span className="font-semibold">Voided{statement.voidedAt ? ` ${statementDay(statement.voidedAt)}` : ""}{statement.voidedByName ? ` by ${statement.voidedByName}` : ""}</span> · &ldquo;{statement.voidReason}&rdquo; Its lines no longer post to the commission ledger.
        </div>
      )}

      {awaitingEntry ? (
        <StatementManualEntry
          statementId={statement.id}
          canWrite={!readOnly}
          writeBlockedReason={readOnly ? "Reading remains available; entering lines is paused while the account is read-only." : null}
        />
      ) : <>
      <StatStrip label="Statement totals">
        <StatTile label="Lines" value={statement.counts.lines.toLocaleString("en-US")} footnote={`${statementMoney(statement.statementCents)} net on the statement`} />
        <StatTile label="Waiting" value={waiting.toLocaleString("en-US")} footnote={voided ? "voided: nothing to decide" : `${statement.counts.proposed.toLocaleString("en-US")} proposed · ${statement.counts.unmatched.toLocaleString("en-US")} without a match`} />
        <StatTile label="Accepted" value={statement.counts.accepted.toLocaleString("en-US")} valueTone={statement.counts.accepted > 0 && !voided ? "good" : undefined} footnote={voided ? `${statementMoney(statement.acceptedCents)} no longer posted` : `${statementMoney(statement.acceptedCents)} posted to the ledger`} />
        <StatTile label="Set aside" value={(statement.counts.leftUnmatched + statement.counts.errors).toLocaleString("en-US")} footnote={`${statement.counts.leftUnmatched.toLocaleString("en-US")} left unmatched · ${statement.counts.errors.toLocaleString("en-US")} could not be read`} />
      </StatStrip>

      <StatementReview
        statementId={statement.id}
        lines={lines}
        policies={policies}
        carrier={carrier}
        voided={voided}
        canWrite={!readOnly && !voided}
        writeBlockedReason={readOnly ? "Reading remains available; decisions are paused while the account is read-only." : null}
        reprocess={canReprocess ? { headers: statement.headers, mapping: statement.mapping } : null}
      />
      </>}
    </div>
  );
}

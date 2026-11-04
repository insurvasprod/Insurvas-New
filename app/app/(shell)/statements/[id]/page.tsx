import Link from "next/link";
import { notFound } from "next/navigation";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { DataInPage } from "@/components/app/data-in/data-in-page";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { Callout } from "@/components/app/settings/primitives";
import { StatementFileButton, StatementManualEntry } from "@/components/app/statement-manual-entry";
import { StatementActions, StatementReview } from "@/components/app/statement-review";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { STATEMENT_SCHEMA_PENDING_MESSAGE, isRecordId, statementDay, statementMoney, statementPeriod } from "@/lib/ledger/statementConstants";
import { getStatementDetail } from "@/lib/ledger/statementService";

/**
 * One carrier statement, and the review that posts its lines. The header says where the file came
 * from and who brought it in; the table below is where every ledger entry gets the name of the
 * person who accepted it.
 *
 * LA-4.1: the original file opens from the header when it was kept. LA-4.2: a PDF statement waits
 * for its lines, and this page is where they are typed in, beside the PDF. LA-4.3: a statement read
 * from a stored CSV or workbook can be re-processed; one that was says which statement it replaced.
 *
 * 2026-10-06 redesign: the statement's actions (Original file, Re-process, Void) are grouped top
 * right in the header; the review below it is one full-height list.
 *
 * Foundation pass 2026-11-03: the page sits in the Book of business frame (step "files", so the rail shows)
 * with the trail Book of business › Files › Statements › the statement. No notice boxes on the page
 * (UI-CONSISTENCY §3): a pending update goes to the bell; a voided statement is a chip on the title line,
 * its date, person and reason in the facts line, and its actions disabled.
 */
export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Statements" description="Import carrier commission statements, match each line to a policy, and post accepted lines to the commission ledger." />;
  }
  if (!actAsPagePermission(guard, "statements.view")) {
    return <RoleGateNotice featureLabel="Statements" detail="Carrier statements are imported and reviewed by the account owner or a bookkeeper." />;
  }

  const { id } = await params;
  if (!isRecordId(id)) notFound();
  const { available, detail } = await getStatementDetail(guard.context.tenantId, id);
  // A detail page's way back is the trail above its title (owner 2026-10-30).
  const trail = (current: string) => [{ label: "Book of business", href: "/app/carrier-files" }, { label: "Files", href: "/app/carrier-files" }, { label: "Statements", href: "/app/statements" }, { label: current }];

  if (!available) {
    return (
      <DataInPage step="files" title="Statement" breadcrumbs={trail("Statement")}>
        <Callout tone="warning" title={STATEMENT_SCHEMA_PENDING_MESSAGE} />
      </DataInPage>
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
  const name = `${statement.carrierName} · ${statementPeriod(statement.periodStart, statement.periodEnd)}`;
  const voidedLine = voided ? `Voided${statement.voidedAt ? ` ${statementDay(statement.voidedAt)}` : ""}${statement.voidedByName ? ` by ${statement.voidedByName}` : ""}` : null;

  return (
    <DataInPage
      step="files"
      title={name}
      breadcrumbs={trail(name)}
      chip={voidedLine ? <span title={`${voidedLine} · “${statement.voidReason ?? ""}” Its lines no longer post to the commission ledger.`}><StatusChip tone="danger">Voided</StatusChip></span> : undefined}
      facts={
        <p className="m-0 mt-1 flex min-w-0 flex-wrap gap-x-1.5 text-sm leading-normal text-muted-foreground">
          <span>{statement.fileName} · {kindLabel} · imported {statementDay(statement.uploadedAt)}{statement.uploadedByName ? ` by ${statement.uploadedByName}` : ""} · {awaitingEntry ? "lines not entered yet" : `${statement.rowCount.toLocaleString("en-US")} ${statement.rowCount === 1 ? "line" : "lines"}`}</span>
          {voidedLine && <span>· {voidedLine}: &ldquo;{statement.voidReason}&rdquo;, its lines no longer post</span>}
          {statement.reprocessedFrom && <span>· <Link className="text-[var(--accent-ink)] hover:underline" href={`/app/statements/${statement.reprocessedFrom}`} title="Re-processed from the stored file of an earlier import, which is voided and kept">re-processed from an earlier import</Link></span>}
        </p>
      }
      actions={<>
        {statement.hasFile && <StatementFileButton statementId={statement.id} />}
        {!awaitingEntry && <StatementActions statementId={statement.id} canWrite={!readOnly && !voided} voided={voided} reprocess={canReprocess ? { headers: statement.headers, mapping: statement.mapping } : null} />}
      </>}
    >
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
      />
      </>}
    </DataInPage>
  );
}

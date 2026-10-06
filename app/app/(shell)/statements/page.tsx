import Link from "next/link";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { StatementImportButton } from "@/components/app/statement-import";
import { StatementsTable } from "@/components/app/statements-table";
import { UnmatchedLinesTable } from "@/components/app/unmatched-lines-table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import {
  STATEMENT_SCHEMA_PENDING_MESSAGE,
  statementMoney,
  type StatementCarrierOption,
  type StatementMapping,
} from "@/lib/ledger/statementConstants";
import { getSavedStatementMappings, listStatementCarriers, listStatements, listUnmatchedLines } from "@/lib/ledger/statementService";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › Statements: every carrier statement imported, newest first, with the import.
 *
 * A statement is a record, not a draft: it is never deleted, only voided with a reason, and each
 * row links to the review screen where its lines are accepted, matched by hand or left unmatched.
 * Owner and bookkeeper only (`statements.view`), the same two roles the API admits.
 *
 * LA-4.3: a second tab, "Unmatched lines", is the queue across every statement — the lines still
 * without a match, which can be re-matched against the book as it is now.
 *
 * 2026-10-06 redesign: the two lists are segmented tabs on one row under the title, with the page's
 * actions on the right of the same row (as on the Agent Floor).
 */

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ import?: string; view?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Statements"
        description="Import carrier commission statements, match each line to a policy, and post accepted lines to the commission ledger."
      />
    );
  }
  if (!hasTenantPermission(guard.role, "statements.view")) {
    return <RoleGateNotice featureLabel="Statements" detail="Carrier statements are imported and reviewed by the account owner or a bookkeeper. Accepted lines for your policies appear on the commission ledger." />;
  }

  const readOnly = guard.entitlement.access === "read_only";
  const [{ available, statements }, { import: importParam, view }] = await Promise.all([listStatements(guard.context.tenantId), searchParams]);
  const showUnmatched = view === "unmatched";
  const unmatched = showUnmatched && available ? await listUnmatchedLines(guard.context.tenantId) : null;
  const blocked = !available ? STATEMENT_SCHEMA_PENDING_MESSAGE : readOnly ? "Importing is paused while the account is read-only." : null;
  const [carriers, savedMappings]: [StatementCarrierOption[], Record<string, StatementMapping>] = blocked
    ? [[], {}]
    : await Promise.all([listStatementCarriers(), getSavedStatementMappings(guard.context.tenantId)]);
  const importControl = blocked ? (
    <Button type="button" disabled title={blocked}>Import statement</Button>
  ) : (
    <StatementImportButton carriers={carriers} savedMappings={savedMappings} autoOpen={importParam === "1"} />
  );

  const standing = statements.filter((statement) => statement.status !== "voided");
  const waiting = standing.reduce((total, statement) => total + statement.counts.proposed + statement.counts.unmatched, 0);
  const acceptedCents = standing.reduce((total, statement) => total + statement.acceptedCents, 0);
  const toReview = standing.filter((statement) => statement.status === "review").length;
  // LA-4.2: PDFs stored and waiting for a person to type their lines in.
  const toType = standing.filter((statement) => statement.status === "awaiting_entry").length;
  const unmatchedCount = standing.reduce((total, statement) => total + statement.counts.unmatched, 0);
  const leftUnmatchedCount = standing.reduce((total, statement) => total + statement.counts.leftUnmatched, 0);
  const actions = <>
    <Button asChild type="button" variant="outline"><Link href="/app/ledger">Commission ledger</Link></Button>
    {importControl}
  </>;

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Statements"
        description="A line posts to the commission ledger only when a person accepts its match."
        actions={statements.length > 0 ? undefined : actions}
      />

      {statements.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ViewTabs
            label="Statement lists"
            active={showUnmatched ? "unmatched" : "statements"}
            tabs={[
              { key: "statements", label: "Statements", count: statements.length, href: "/app/statements" },
              { key: "unmatched", label: "Unmatched lines", count: unmatchedCount, href: "/app/statements?view=unmatched" },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      )}

      {blocked && (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">
          {blocked}
        </div>
      )}

      {statements.length > 0 && (
        <StatStrip label="Statement totals">
          <StatTile label="Statements" value={standing.length.toLocaleString("en-US")} footnote={`${(statements.length - standing.length).toLocaleString("en-US")} voided`} />
          <StatTile label="To review" value={toReview.toLocaleString("en-US")} valueTone={toReview ? "warning" : undefined} footnote={toType ? `${toType.toLocaleString("en-US")} ${toType === 1 ? "PDF" : "PDFs"} to type in` : undefined} />
          <StatTile label="Lines waiting" value={waiting.toLocaleString("en-US")} footnote="for a person" />
          <StatTile label="Accepted" value={statementMoney(acceptedCents)} footnote="posted to the ledger" />
        </StatStrip>
      )}

      {showUnmatched && unmatched ? (
        <UnmatchedLinesTable lines={unmatched.lines} leftUnmatchedCount={leftUnmatchedCount} canWrite={!readOnly} writeBlockedReason={readOnly ? "Re-matching is paused while the account is read-only." : null} />
      ) : (
        <StatementsTable
          statements={statements}
          readOnly={readOnly}
          emptyTitle={available ? "No statement imported yet" : "Statements are not available yet"}
          emptyHint={available ? "Import a carrier's commission statement as CSV, Excel or PDF to review its lines." : STATEMENT_SCHEMA_PENDING_MESSAGE}
        />
      )}
    </div>
  );
}

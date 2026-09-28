import Link from "next/link";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { StatementImportButton } from "@/components/app/statement-import";
import { StatementsTable } from "@/components/app/statements-table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import {
  STATEMENT_SCHEMA_PENDING_MESSAGE,
  statementMoney,
  type StatementCarrierOption,
  type StatementMapping,
} from "@/lib/ledger/statementConstants";
import { getSavedStatementMappings, listStatementCarriers, listStatements } from "@/lib/ledger/statementService";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * Book of Business › Statements: every carrier statement imported, newest first, with the import.
 *
 * A statement is a record, not a draft: it is never deleted, only voided with a reason, and each
 * row links to the review screen where its lines are accepted, matched by hand or left unmatched.
 * Owner and bookkeeper only (`statements.view`), the same two roles the API admits.
 */

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
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
  const [{ available, statements }, { import: importParam }] = await Promise.all([listStatements(guard.context.tenantId), searchParams]);
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

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Statements"
        description="A line posts to the commission ledger only when a person accepts its match."
        actions={<>
          <Button asChild type="button" variant="outline"><Link href="/app/ledger">Commission ledger</Link></Button>
          {importControl}
        </>}
      />

      {blocked && (
        <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">
          {blocked}
        </div>
      )}

      {statements.length > 0 && (
        <StatStrip label="Statement totals">
          <StatTile label="Statements" value={standing.length.toLocaleString("en-US")} footnote={`${(statements.length - standing.length).toLocaleString("en-US")} voided`} />
          <StatTile label="To review" value={toReview.toLocaleString("en-US")} valueTone={toReview ? "warning" : undefined} />
          <StatTile label="Lines waiting" value={waiting.toLocaleString("en-US")} footnote="for a person" />
          <StatTile label="Accepted" value={statementMoney(acceptedCents)} footnote="posted to the ledger" />
        </StatStrip>
      )}

      <StatementsTable
        statements={statements}
        emptyTitle={available ? "No statement imported yet" : "Statements are not available yet"}
        emptyHint={available ? "Import a carrier's commission statement as CSV to review its lines." : STATEMENT_SCHEMA_PENDING_MESSAGE}
      />
    </div>
  );
}

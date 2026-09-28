import Link from "next/link";

import { guardPage } from "@/lib/entitlements/guardPage";
import { hasFeature, isDisabledForTenant } from "@/lib/entitlements/types";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { ExpectedEntriesTable, ReconciliationTable, StatementEntriesTable } from "@/components/app/ledger-statement-sections";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { StatementImportButton } from "@/components/app/statement-import";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { getCommissionLedger } from "@/lib/ledger/service";
import { STATEMENT_SCHEMA_PENDING_MESSAGE, type StatementCarrierOption, type StatementMapping } from "@/lib/ledger/statementConstants";
import { reconcileStatements, statementTotals } from "@/lib/ledger/statementMatch";
import { getSavedStatementMappings, getStatementLedger, listStatementCarriers } from "@/lib/ledger/statementService";
import { hasTenantPermission, roleCanViewCommission } from "@/lib/tenantAuth/permissions";

/**
 * The commission ledger, in two halves that are never mixed:
 *
 *   REPORTED — lines from carrier statements that a person matched to a policy and accepted
 *   (lib/ledger/statementService.ts). These are the entries the four tiles count: the board's rule
 *   is "Nothing is recorded automatically without a source", and a statement line with an accepted
 *   match is the only thing here that has one.
 *
 *   EXPECTED — the book of business multiplied by the carrier library's schedules and advance
 *   rules (lib/ledger/compute.ts). Nothing is typed in; a policy the library cannot price is listed
 *   with its reason, not guessed at.
 *
 * Where a policy has both, the reconciliation table compares them for the statement periods.
 *
 * The stat strip counts the reported half; with no expected entry and no statement the page shows
 * the empty state under it. Otherwise the tables follow.
 */

const wholeMoney = (cents: number) => `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  const guard = await guardPage("commission_ledger");
  if (!guard.entitled) {
    return (
      <FeatureGateNotice
        guard={guard}
        featureLabel="Commission ledger"
        description="Review commission entries and the source policy or statement behind each amount."
      />
    );
  }
  if (guard.role !== "owner" && guard.role !== "producer" && guard.role !== "bookkeeper") {
    return <RoleGateNotice featureLabel="Commission ledger" detail="Your tenant role does not include commission visibility." />;
  }
  const readOnly = guard.entitlement.access === "read_only";
  // Producers see their own policies only (LA-0.2 criterion 3); owners and bookkeepers see all. The
  // same rule scopes the statement lines: a line shows only when its matched policy does.
  const canView = (producerUserId: string | undefined) => roleCanViewCommission(guard.role, guard.context.userId, producerUserId);
  const [ledger, statements, { import: importParam }] = await Promise.all([
    getCommissionLedger({ tenantId: guard.context.tenantId, canView }),
    getStatementLedger({ tenantId: guard.context.tenantId, canView }),
    searchParams,
  ]);
  const { totals, entries, gaps } = ledger;
  const isOwner = guard.role === "owner";

  // Who may import, and when not, the reason — printed, never only a tooltip.
  const handlesStatements = hasTenantPermission(guard.role, "statements.view");
  const statementsOnPlan = hasFeature(guard.entitlement, "statement_ingestion");
  const importBlocked = !handlesStatements
    ? "Statements are imported by the account owner or a bookkeeper. Entries appear here once one of them accepts a match."
    : !statementsOnPlan
      ? isDisabledForTenant(guard.entitlement, "statement_ingestion")
        ? "Carrier statement import is not available on your account."
        : "Your plan does not include carrier statement import."
      : !statements.available
        ? STATEMENT_SCHEMA_PENDING_MESSAGE
        : readOnly
          ? "Importing is paused while the account is read-only."
          : null;
  const [carriers, savedMappings]: [StatementCarrierOption[], Record<string, StatementMapping>] = importBlocked
    ? [[], {}]
    : await Promise.all([listStatementCarriers(), getSavedStatementMappings(guard.context.tenantId)]);
  const importControl = importBlocked ? (
    <Button type="button" disabled title={importBlocked}>Import statement</Button>
  ) : (
    <StatementImportButton carriers={carriers} savedMappings={savedMappings} autoOpen={importParam === "1"} />
  );

  const reported = statements.entries;
  const reportedTotals = statementTotals(reported);
  const statementsBehindEntries = new Set(reported.map((entry) => entry.statementId)).size;
  const chargebackLines = reported.filter((entry) => entry.kind === "chargeback").length;
  // "no source connected" is the board's footnote for a ledger with no statement at all.
  const noSource = !statements.available || (handlesStatements ? statements.statementsImported === 0 : reported.length === 0);
  const note = (withEntries: string) => (noSource ? "no source connected" : reportedTotals.entries === 0 ? "nothing accepted yet" : withEntries);

  const isEmpty = entries.length === 0 && reported.length === 0 && (!handlesStatements || statements.statementsImported === 0);

  const alert = "rounded-lg border border-border border-l-[3px] px-4 py-3 text-sm";

  const reconciliation = reconcileStatements(entries, reported, new Set(entries.map((entry) => entry.policyId)));
  const policyLabels: Record<string, { policyNumber: string; insuredName: string; carrierName: string }> = {};
  for (const entry of reported) policyLabels[entry.policyId] = { policyNumber: entry.policyNumber, insuredName: entry.insuredName, carrierName: entry.carrierName };
  for (const entry of entries) if (policyLabels[entry.policyId]) policyLabels[entry.policyId] = { policyNumber: entry.policyNumber, insuredName: entry.insuredName, carrierName: entry.carrierName };

  const expectedSummary = `${wholeMoney(totals.grossCents)} gross · ${wholeMoney(totals.advancesCents)} advanced · ${wholeMoney(totals.chargebacksCents)} charged back · ${totals.exposureCents > 0 ? `${wholeMoney(totals.exposureCents)} still exposed` : "nothing exposed"} · derived from ${plural(ledger.policiesRead, "policy", "policies")}`;

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        title="Commission ledger"
        actions={
          <>
            {handlesStatements && statementsOnPlan && statements.statementsImported > 0 && (
              <Button asChild type="button" variant="outline"><Link href="/app/statements">Statement history</Link></Button>
            )}
            {importControl}
          </>
        }
      />

      {readOnly && <div role="status" className={`${alert} border-l-[var(--warning)] bg-[var(--warning-surface)] text-[var(--warning-ink)]`}>Your account is read-only. Reading remains available; new money records are disabled.</div>}
      {importBlocked && !readOnly && <div role="status" className={`${alert} border-l-[var(--warning)] bg-[var(--warning-surface)] text-[var(--warning-ink)]`}>{importBlocked}</div>}
      {/* Proposed and unmatched lines post nothing until a person decides them. */}
      {handlesStatements && statements.awaitingReview.lines > 0 && (
        <div role="status" className={`${alert} border-l-[var(--info)] bg-[var(--info-surface)] text-[var(--info-ink)]`}>
          {plural(statements.awaitingReview.lines, "statement line is", "statement lines are")} waiting for someone to accept a match.{" "}
          {statementsOnPlan && <Link href="/app/statements" className="font-semibold underline">Review in Statements</Link>}
        </div>
      )}
      {/* A policy the library cannot price is the most common reason the ledger is short — say which. */}
      {gaps.length > 0 && (
        <div role="status" className={`${alert} border-l-[var(--info)] bg-[var(--info-surface)] text-[var(--info-ink)]`} title={gaps.map((gap) => `${gap.policyNumber} — ${gap.reason}`).join("\n")}>
          {gaps.length} {gaps.length === 1 ? "policy has" : "policies have"} no commission figure ({gaps.slice(0, 5).map((gap) => gap.policyNumber).join(", ")}{gaps.length > 5 ? `, +${gaps.length - 5} more` : ""}).{" "}
          {isOwner ? <>Add the missing schedule in the <Link href="/app/settings#carrier-library" className="font-semibold underline">carrier library</Link>.</> : "The account owner adds the missing schedule in the carrier library."}
        </div>
      )}

      <StatStrip label="Reported commission">
        <StatTile label="Entries" value={reportedTotals.entries.toLocaleString()} footnote={note(`from ${plural(statementsBehindEntries, "statement", "statements")}`)} />
        <StatTile label="Gross commission" value={wholeMoney(reportedTotals.grossCents)} valueTone={reportedTotals.grossCents > 0 ? "good" : undefined} footnote={note(reportedTotals.adjustmentsCents !== 0 ? `incl. ${wholeMoney(reportedTotals.adjustmentsCents)} adjustments` : "advances and commission received")} />
        <StatTile label="Advances" value={wholeMoney(reportedTotals.advancesCents)} footnote={note("paid ahead of earning")} />
        <StatTile label="Chargebacks" value={wholeMoney(reportedTotals.chargebacksCents)} valueTone={reportedTotals.chargebacksCents !== 0 ? "danger" : undefined} footnote={note(chargebackLines ? `${plural(chargebackLines, "line", "lines")} taken back` : "none reported")} />
      </StatStrip>

      {isEmpty ? (
        <TableCard>
          <EmptyState
            title="Nothing is recorded yet"
            hint={`${ledger.policiesRead === 0 ? "Your book has no policies to price" : "No policy in your book can be priced by the carrier library yet"}${statements.available ? ", and no carrier statement has been imported." : ", and carrier statement import is waiting on a database update."}`}
            action={<Button asChild type="button" variant="outline"><Link href="/app/policies">Review policy transactions</Link></Button>}
          />
        </TableCard>
      ) : (
        <>
          {reconciliation.length > 0 && <ReconciliationTable rows={reconciliation} policies={policyLabels} />}
          {reported.length > 0 && <StatementEntriesTable entries={reported} canOpenStatements={handlesStatements && statementsOnPlan} />}
          {entries.length > 0 && <ExpectedEntriesTable entries={entries} summary={expectedSummary} />}
        </>
      )}
    </div>
  );
}

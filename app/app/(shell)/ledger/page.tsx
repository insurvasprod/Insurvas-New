import Link from "next/link";
import { Callout } from "@/components/app/settings/primitives";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { hasFeature, isDisabledForTenant } from "@/lib/entitlements/types";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { ViewTabs } from "@/components/app/book-of-business-views";
import { CarrierAccounts } from "@/components/app/carrier-accounts";
import { CarrierLedger, type LedgerLine } from "@/components/app/carrier-ledger";
import { LEDGER_SLOT } from "@/components/app/commissions/slots";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { LedgerViews } from "@/components/app/ledger-statement-sections";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { StatementImportButton } from "@/components/app/statement-import";
import { Button } from "@/components/ui/button";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ACCOUNTS_PENDING_MESSAGE, loadAccounts } from "@/lib/ingestion/carrierAccountsStore";
import { LEDGER_PENDING_MESSAGE, loadLedger, statementLinesAsLedger } from "@/lib/ingestion/commissionLedgerStore";
import { getCommissionLedger } from "@/lib/ledger/service";
import { ledgerNames } from "@/lib/commissions/ledgerNames";
import { STATEMENT_SCHEMA_PENDING_MESSAGE, type StatementCarrierOption, type StatementMapping } from "@/lib/ledger/statementConstants";
import { reconcileStatements, statementTotals } from "@/lib/ledger/statementMatch";
import { getSavedStatementMappings, getStatementLedger, listStatementCarriers } from "@/lib/ledger/statementService";
import { rowVisible, scopeFor } from "@/lib/agency/visibility";
import { hasTenantPermission, roleCanViewCommission } from "@/lib/tenantAuth/permissions";

/**
 * The commission ledger (2026-10-08 overlap merge: one list of lines, not a tab per source):
 *
 *   LINES — every commission line: each line of every carrier commission file (LA-4.12, never
 *   edited), and each line of a statement imported by hand that a person matched to a policy and
 *   accepted (lib/ledger/statementService.ts). A source filter shows either. Importing a statement
 *   by hand, for a carrier that sends no file, is the header's action.
 *
 *   CARRIER ACCOUNTS — each carrier's running account, statement by statement (LA-4.14).
 *
 *   EXPECTED (ENTERED BY HAND) — the hand-entered book multiplied by the carrier library's schedules
 *   and advance rules (lib/ledger/compute.ts), and where a policy also has statement lines, the two
 *   compared. Carrier-file policies have their expected figures from the rates in Book setup and on Pay issues.
 *
 * The old "Statements you import" address (?view=statements) lands on the lines, filtered to them.
 */

const wholeMoney = (cents: number) => `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ import?: string; view?: string; source?: string; type?: string }> }) {
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
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Commission ledger" detail="Your tenant role does not include commission visibility." />;
  }
  const readOnly = guard.entitlement.access === "read_only";
  const params = await searchParams;
  // Carrier accounts are the agency's running balances with each carrier: owners and bookkeepers only.
  const seesAccounts = guard.role === "owner" || guard.role === "bookkeeper";
  const view = params.view === "accounts" && seesAccounts ? "accounts" : params.view === "expected" ? "expected" : "lines";
  // The same three tabs on the title line of every view (UI-CONSISTENCY §8a): Lines · Carrier accounts (owner
  // and bookkeeper) · Expected. Expected keeps its tab while empty; its view says why.
  const sourceTabs = (
    <ViewTabs
      label="Ledger views"
      active={view}
      tabs={[
        { key: "lines", label: "Lines", href: "/app/ledger" },
        ...(seesAccounts ? [{ key: "accounts", label: "Carrier accounts", href: "/app/ledger?view=accounts" }] : []),
        { key: "expected", label: "Expected", href: "/app/ledger?view=expected" },
      ]}
    />
  );

  // LA-4.14: each carrier's running account, statement by statement, and unattributed lines.
  if (view === "accounts") {
    const accounts = await loadAccounts(guard.context.tenantId);
    return (
      <CommissionsPage step="ledger" lead={sourceTabs}>
        {accounts.available
          ? <CarrierAccounts orphanDays={accounts.orphanDays} statements={accounts.statements} orphans={accounts.orphans} files={accounts.files} carriers={accounts.carriers} readOnly={readOnly || (guard.role !== "owner" && guard.role !== "bookkeeper")} today={new Date().toISOString().slice(0, 10)} />
          : <Callout tone="warning" title={<>{ACCOUNTS_PENDING_MESSAGE}</>} />}
      </CommissionsPage>
    );
  }

  // Producers see their own policies only (LA-0.2 criterion 3); owners and bookkeepers see all. The
  // same rule scopes the statement lines: a line shows only when its matched policy does.
  // AG-0.5: the role rule (a producer sees his own) AND the session's producer scope — in an agency both must hold.
  const scope = await scopeFor(guard.context);
  const canView = (producerUserId: string | undefined) => roleCanViewCommission(guard.role, guard.context.userId, producerUserId) && rowVisible(scope, producerUserId);
  const importParam = params.import;
  // Who may import, and when not, the reason — printed, never only a tooltip.
  const handlesStatements = hasTenantPermission(guard.role, "statements.view");
  const statementsOnPlan = hasFeature(guard.entitlement, "statement_ingestion");
  const importBlockedFor = (statementsAvailable: boolean) => !handlesStatements
    ? "Statements are imported by the account owner or a bookkeeper. Entries appear here once one of them accepts a match."
    : !statementsOnPlan
      ? isDisabledForTenant(guard.entitlement, "statement_ingestion")
        ? "Carrier statement import is not available on your account."
        : "Your plan does not include carrier statement import."
      : !statementsAvailable
        ? STATEMENT_SCHEMA_PENDING_MESSAGE
        : readOnly
          ? "Importing is paused while the account is read-only."
          : null;
  // What waits on the statement lines (the import picker's carriers and mappings, the hand lines as ledger
  // rows) starts as soon as they are in, beside the other two reads, rather than after all three.
  const statementsRead = getStatementLedger({ tenantId: guard.context.tenantId, canView });
  const [ledger, statements, book, [carriers, savedMappings], handLines] = await Promise.all([
    getCommissionLedger({ tenantId: guard.context.tenantId, canView }),
    statementsRead,
    view === "lines" ? loadLedger({ tenantId: guard.context.tenantId, userId: guard.context.userId, role: guard.role }) : null,
    statementsRead.then((read): Promise<[StatementCarrierOption[], Record<string, StatementMapping>]> | [StatementCarrierOption[], Record<string, StatementMapping>] => importBlockedFor(read.available)
      ? [[], {}]
      : Promise.all([listStatementCarriers(guard.context.tenantId), getSavedStatementMappings(guard.context.tenantId)])),
    view === "lines" ? statementsRead.then((read) => statementLinesAsLedger(read.entries)) : null,
  ]);
  const { totals, entries, gaps } = ledger;
  const isOwner = guard.role === "owner";
  const importBlocked = importBlockedFor(statements.available);
  const importControl = importBlocked ? (
    <Button type="button" disabled title={importBlocked}>Import a statement</Button>
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

  const reconciliation = reconcileStatements(entries, reported, new Set(entries.map((entry) => entry.policyId)));
  const policyLabels: Record<string, { policyNumber: string; insuredName: string; carrierName: string }> = {};
  for (const entry of reported) policyLabels[entry.policyId] = { policyNumber: entry.policyNumber, insuredName: entry.insuredName, carrierName: entry.carrierName };
  for (const entry of entries) if (policyLabels[entry.policyId]) policyLabels[entry.policyId] = { policyNumber: entry.policyNumber, insuredName: entry.insuredName, carrierName: entry.carrierName };

  const expectedSummary = `${wholeMoney(totals.grossCents)} gross · ${wholeMoney(totals.advancesCents)} advanced · ${wholeMoney(totals.chargebacksCents)} charged back · ${totals.exposureCents > 0 ? `${wholeMoney(totals.exposureCents)} still exposed` : "nothing exposed"} · derived from ${plural(ledger.policiesRead, "policy", "policies")}`;

  const headerActions = (
    // Statements is the step before on the rail (2026-11-02), so only the import stays here. Board 12 (2026-11-03):
    // More (Export CSV; the lines fill it through LEDGER_SLOT), then the one primary. The views are tabs.
    <>{view === "lines" ? <StepSlotTarget id={LEDGER_SLOT} /> : null}{importControl}</>
  );

  const notices = (
    <>
      {readOnly && <Callout tone="warning" title={<>Your account is read-only. Reading remains available; new money records are disabled.</>} />}
      {importBlocked && handlesStatements && !readOnly && <Callout tone="warning" title={<>{importBlocked}</>} />}
      {/* Proposed and unmatched lines post nothing until a person decides them. */}
      {handlesStatements && statements.awaitingReview.lines > 0 && (
        <Callout tone="info" title={<>{plural(statements.awaitingReview.lines, "statement line is", "statement lines are")} waiting for someone to accept a match.{" "}
          {statementsOnPlan && <Link href="/app/statements" className="font-semibold underline">Review in Statements</Link>}</>} />
      )}
    </>
  );

  const showExpected = entries.length > 0 || reconciliation.length > 0;

  if (view === "lines") {
    // Newest statement first, whichever source a line came from.
    const sorted = [...(book?.available ? book.entries : []), ...(handLines ?? [])].sort((a, b) => String(b.statementDate ?? b.transactionDate ?? "").localeCompare(String(a.statementDate ?? a.transactionDate ?? "")));
    // Board 12: the Client and Agent of each line, when the data has them (a column empty on every row is not drawn).
    const names = await ledgerNames(guard.context.tenantId, sorted);
    const insured = new Map(reported.map((entry) => [`hand:${entry.id}`, entry.insuredName]));
    const lines: LedgerLine[] = sorted.map((row) => ({
      ...row,
      clientName: row.source === "hand" ? insured.get(row.id)?.trim() || null : row.account ? null : names.clientOf(row.carrierId, row.policyNumber),
      agentName: row.account ? null : names.agentOf(row.carrierId, row.policyNumber, row.agentUserId),
    }));
    return (
      <CommissionsPage step="ledger" lead={sourceTabs} actions={headerActions}>
        {notices}
        {book && !book.available && <Callout tone="warning" title={<>{LEDGER_PENDING_MESSAGE}</>} />}
        {book?.available && book.truncated && <Callout tone="warning" title={<>Showing the newest {book.cap.toLocaleString("en-US")} lines from carrier files; older lines, and their amounts, are left out of the list and the figures here.</>} />}
        <CarrierLedger key={`${params.type ?? ""}|${params.source ?? ""}|${params.view ?? ""}`} entries={lines} scoped={guard.role === "producer"} initialSource={params.view === "statements" ? "hand" : params.source ?? ""} initialType={params.type ?? ""} />
      </CommissionsPage>
    );
  }

  const expectedNotices = (
    <>
      {/* A policy the library cannot price is the most common reason the ledger is short — say which. */}
      {gaps.length > 0 && (
        <Callout tone="info" title={`${gaps.length} ${gaps.length === 1 ? "policy has" : "policies have"} no commission figure`}>
          ({gaps.slice(0, 5).map((gap) => gap.policyNumber).join(", ")}{gaps.length > 5 ? `, +${gaps.length - 5} more` : ""}).{" "}
          {isOwner ? <>Add the missing rate in <Link href="/app/book-setup" className="font-semibold underline">Book setup</Link>.</> : "The account owner adds the missing rate in Book setup."}
        </Callout>
      )}

      <StatStrip label="Reported commission">
        <StatTile label="Entries" value={reportedTotals.entries.toLocaleString()} footnote={note(`from ${plural(statementsBehindEntries, "statement", "statements")}`)} />
        <StatTile label="Gross commission" value={wholeMoney(reportedTotals.grossCents)} valueTone={reportedTotals.grossCents > 0 ? "good" : undefined} footnote={note(reportedTotals.adjustmentsCents !== 0 ? `incl. ${wholeMoney(reportedTotals.adjustmentsCents)} adjustments` : "advances and commission received")} />
        <StatTile label="Advances" value={wholeMoney(reportedTotals.advancesCents)} footnote={note("paid ahead of earning")} />
        <StatTile label="Chargebacks" value={wholeMoney(reportedTotals.chargebacksCents)} valueTone={reportedTotals.chargebacksCents !== 0 ? "danger" : undefined} footnote={note(chargebackLines ? `${plural(chargebackLines, "line", "lines")} taken back` : "none reported")} />
      </StatStrip>
    </>
  );

  return (
    <CommissionsPage step="ledger" lead={sourceTabs} actions={headerActions}>
      {!showExpected ? (
        <>
          {notices}
          <TableCard>
            <EmptyState
              title="Nothing expected from hand-entered policies"
              hint={`${ledger.policiesRead === 0 ? "No policy has been entered by hand" : "No hand-entered policy can be priced by the carrier library yet"}. Policies from carrier files are priced by the rates in Book setup.`}
              action={<Button asChild type="button" variant="outline"><Link href="/app/policies?source=hand">Policies entered by hand</Link></Button>}
            />
          </TableCard>
        </>
      ) : (
        <LedgerViews
          reconciliation={reconciliation}
          policies={policyLabels}
          reported={[]}
          canOpenStatements={handlesStatements && statementsOnPlan}
          expected={entries}
          expectedSummary={expectedSummary}
        >
          {notices}
          {expectedNotices}
        </LedgerViews>
      )}
    </CommissionsPage>
  );
}

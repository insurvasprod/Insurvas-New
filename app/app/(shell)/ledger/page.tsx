import Link from "next/link";
import { FileText } from "lucide-react";

import { guardPage } from "@/lib/entitlements/guardPage";
import { hasFeature, isDisabledForTenant } from "@/lib/entitlements/types";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { ReconciliationTable, StatementEntriesTable } from "@/components/app/ledger-statement-sections";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { StatementImportButton } from "@/components/app/statement-import";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { getCommissionLedger } from "@/lib/ledger/service";
import type { LedgerEntryKind } from "@/lib/ledger/compute";
import { STATEMENT_SCHEMA_PENDING_MESSAGE, type StatementCarrierOption, type StatementMapping } from "@/lib/ledger/statementConstants";
import { reconcileStatements, statementTotals } from "@/lib/ledger/statementMatch";
import { getSavedStatementMappings, getStatementLedger, listStatementCarriers } from "@/lib/ledger/statementService";
import { sectionForPath } from "@/lib/menu/definition";
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
 * The board draws the empty state: no expected entry and no statement. With entries, the same
 * four figures carry real totals and the tables follow.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso; };
const money = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const wholeMoney = (cents: number) => `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
const KIND: Record<LedgerEntryKind, { label: string; chip: string }> = {
  advance: { label: "Advance", chip: "bg-[var(--info-surface)] text-[var(--info-ink)]" },
  commission: { label: "Commission", chip: "bg-[var(--success-surface)] text-[var(--success-ink)]" },
  chargeback: { label: "Chargeback", chip: "bg-[var(--error-surface)] text-[var(--error-ink)]" },
};
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
    <Button type="button" variant="outline" className="h-11 border-[var(--border-strong)] px-4" disabled title={importBlocked}>Import statement</Button>
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

  const tiles = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label="Entries" value={reportedTotals.entries.toLocaleString()} footnote={note(`from ${plural(statementsBehindEntries, "statement", "statements")}`)} />
      <StatTile label="Gross commission" value={wholeMoney(reportedTotals.grossCents)} valueTone={reportedTotals.grossCents > 0 ? "good" : undefined} footnote={note(reportedTotals.adjustmentsCents !== 0 ? `received, incl. ${wholeMoney(reportedTotals.adjustmentsCents)} adjustments` : "advances and commission received")} />
      <StatTile label="Advances" value={wholeMoney(reportedTotals.advancesCents)} footnote={note("paid ahead of earning")} />
      <StatTile label="Chargebacks" value={wholeMoney(reportedTotals.chargebacksCents)} valueTone={reportedTotals.chargebacksCents !== 0 ? "danger" : undefined} footnote={note(chargebackLines ? `${plural(chargebackLines, "line", "lines")} taken back` : "none reported")} />
    </div>
  );

  const disabledNote = importBlocked && (
    <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
      <p className="font-semibold text-[var(--warning-ink)]">Import statement is disabled, and says why</p>
      <p className="mt-1.5 text-[var(--body)]">&ldquo;{importBlocked}&rdquo; A disabled control with a stated reason is honest; an enabled control with no backend is not.</p>
    </div>
  );

  // Proposed and unmatched lines post nothing until a person decides them; say how many are waiting.
  const waiting = handlesStatements && statements.awaitingReview.lines > 0 && (
    <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
      <p className="font-semibold text-[var(--info-ink)]">{plural(statements.awaitingReview.lines, "statement line is", "statement lines are")} waiting for someone to accept a match</p>
      <p className="mt-1.5 text-[var(--body)]">
        On {plural(statements.awaitingReview.statements, "statement", "statements")}. Nothing on {statements.awaitingReview.lines === 1 ? "it" : "them"} posts until it is accepted or matched by hand.{" "}
        {statementsOnPlan && <Link href="/app/statements" className="font-semibold underline">Review in Statements</Link>}
      </p>
    </div>
  );

  // A policy the library cannot price is the most common reason the ledger is short — say which, and why.
  const gapNote = gaps.length > 0 && (
    <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
      <p className="font-semibold text-[var(--info-ink)]">{gaps.length} {gaps.length === 1 ? "policy has" : "policies have"} no commission figure</p>
      <ul className="mt-1.5 space-y-1 text-[var(--body)]">
        {gaps.slice(0, 5).map((gap) => <li key={gap.policyId}><strong>{gap.policyNumber}</strong> — {gap.reason}</li>)}
        {gaps.length > 5 && <li>…and {gaps.length - 5} more.</li>}
      </ul>
      <p className="mt-1.5 text-[var(--body)]">
        {isOwner ? <>Add the missing carrier, contract level or schedule in the <Link href="/app/settings#carrier-library" className="font-semibold underline">carrier library</Link> and the entry appears here.</> : "The account owner adds the missing schedule in the carrier library; the entry then appears here."}
      </p>
    </div>
  );

  const reconciliation = reconcileStatements(entries, reported, new Set(entries.map((entry) => entry.policyId)));
  const policyLabels = new Map<string, { policyNumber: string; insuredName: string; carrierName: string }>();
  for (const entry of reported) policyLabels.set(entry.policyId, { policyNumber: entry.policyNumber, insuredName: entry.insuredName, carrierName: entry.carrierName });
  for (const entry of entries) if (policyLabels.has(entry.policyId)) policyLabels.set(entry.policyId, { policyNumber: entry.policyNumber, insuredName: entry.insuredName, carrierName: entry.carrierName });

  const expectedSummary = `${wholeMoney(totals.grossCents)} gross · ${wholeMoney(totals.advancesCents)} advanced · ${wholeMoney(totals.chargebacksCents)} charged back · ${totals.exposureCents > 0 ? `${wholeMoney(totals.exposureCents)} still exposed` : "nothing exposed"}. Derived, not received: premium × the carrier library's schedules, from ${plural(ledger.policiesRead, "policy", "policies")}.`;

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        eyebrow={sectionForPath("/app/ledger") ?? undefined}
        title="Commission ledger"
        actions={isEmpty ? undefined : (
          <>
            {handlesStatements && statementsOnPlan && statements.statementsImported > 0 && (
              <Button asChild type="button" variant="ghost" className="h-11 px-4"><Link href="/app/statements">Statement history</Link></Button>
            )}
            {importControl}
          </>
        )}
      />

      {isEmpty ? (
        <div className="flex justify-center">
          <div className="w-full max-w-[620px]">
            <section className="rounded-lg border border-border bg-card p-8 text-center shadow-[0_1px_2px_rgba(16,20,26,.05)]">
              <span className="inline-flex size-[52px] items-center justify-center rounded-full bg-[var(--surface-alt)] text-muted-foreground" aria-hidden="true"><FileText className="size-6" /></span>
              <h2 className="mt-4 text-2xl font-semibold leading-[1.21] tracking-[-0.02em]">Nothing is recorded yet</h2>
              <p className="mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
                {ledger.policiesRead === 0 ? "Your book has no policies to price" : "No policy in your book can be priced by the carrier library yet"}
                {statements.available ? ", and no carrier statement has been imported" : ", and carrier statement import is waiting on a database update"}, so there is nothing to trace.{" "}
                The four figures below read <strong>0</strong> because zero is the true value — not because a request failed.
              </p>
              <p className="mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
                <strong>Nothing is recorded automatically without a source.</strong> Every entry will keep the statement it came from, the policy it matched and who accepted the match.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button asChild type="button" variant="outline" className="h-11 border-[var(--border-strong)] px-4"><Link href="/app/policies">Review policy transactions</Link></Button>
                {importControl}
              </div>
              {readOnly && <p className="mt-4 text-xs font-medium text-[var(--warning-ink)]">Reading remains available; new money records are disabled while the account is suspended.</p>}
            </section>
            <div className="mt-7 flex flex-col gap-5">
              {tiles}
              {gapNote}
              {disabledNote}
            </div>
          </div>
        </div>
      ) : (
        <>
          {tiles}
          {waiting}
          {gapNote}
          {reconciliation.length > 0 && <ReconciliationTable rows={reconciliation} policies={policyLabels} />}
          {reported.length > 0 && <StatementEntriesTable entries={reported} canOpenStatements={handlesStatements && statementsOnPlan} />}
          {entries.length > 0 && (
            <TableCard
              title="Expected from your book"
              description={expectedSummary}
              footer={<><span>{entries.length.toLocaleString()} {entries.length === 1 ? "entry" : "entries"} · newest first</span><span>Every figure resolves to a schedule row in the carrier library</span></>}
            >
              <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr>
                    <th className="w-[110px]">Posted</th>
                    <th>Policy</th>
                    <th>Carrier · product</th>
                    <th className="w-[120px]">Kind</th>
                    <th className="w-[80px] text-right">Year</th>
                    <th className="w-[90px] text-right">Rate</th>
                    <th className="w-[130px] text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {[...entries].sort((a, b) => b.postedOn.localeCompare(a.postedOn)).map((entry) => (
                    <tr key={entry.id} className="m-row">
                      <td className="tabular-nums">{day(entry.postedOn)}</td>
                      <td>
                        <span className="block font-semibold text-foreground">{entry.policyNumber}</span>
                        <span className="block text-xs text-muted-foreground">{entry.insuredName}</span>
                      </td>
                      <td>{entry.carrierName} · {entry.productName}</td>
                      <td><span className={`inline-flex rounded-full px-2.5 py-[3px] text-xs font-semibold ${KIND[entry.kind].chip}`}>{KIND[entry.kind].label}</span></td>
                      <td className="text-right tabular-nums">{entry.policyYear}</td>
                      <td className="text-right tabular-nums">{entry.rateBp == null ? "—" : `${(entry.rateBp / 100).toFixed(2)}%`}</td>
                      <td className={`text-right font-semibold tabular-nums ${entry.amountCents < 0 ? "text-[var(--error-ink)]" : "text-foreground"}`}>{money(entry.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}
          {disabledNote}
          {readOnly && <p className="text-xs font-medium text-[var(--warning-ink)]">Reading remains available; new money records are disabled while the account is suspended.</p>}
        </>
      )}
    </div>
  );
}

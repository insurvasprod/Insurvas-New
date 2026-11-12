import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ViewTabs } from "@/components/ui/view-tabs";
import { StatementImportButton } from "@/components/app/statement-import";
import { StatementsTable } from "@/components/app/statements-table";
import { UnmatchedLinesTable } from "@/components/app/unmatched-lines-table";
import { Button } from "@/components/ui/button";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { STATEMENT_VIEWS, parseStatementsView, statementViewCounts, statementsOn, statementsViewHref } from "@/components/app/commissions/statements/list-order";
import { STATEMENT_EXPLAINER } from "@/lib/dashboard/checklist";
import {
  STATEMENT_SCHEMA_PENDING_MESSAGE,
  type StatementCarrierOption,
  type StatementMapping,
} from "@/lib/ledger/statementConstants";
import { getSavedStatementMappings, listStatementCarriers, listStatements, listUnmatchedLines, listWaitingCents } from "@/lib/ledger/statementService";

/**
 * Commissions › Statements: every carrier statement imported, with the import.
 *
 * A statement is a record, not a draft: it is never deleted, only voided with a reason, and each row opens the
 * statement, where its lines are accepted, matched by hand or left unmatched. Owner and bookkeeper only
 * (`statements.view`), the same two roles the API admits.
 *
 * Round 7 (owner pick 1·A, 2026-11-10; docs/la4/mockups-r7/commissions.html board 1·A): the page is the first step
 * of the Commissions rail. Its tabs are what is left to do — To review (a line waits for a person, a line could not
 * be read, or a PDF's lines wait to be typed in), Lines to match (LA-4.3: every unmatched line across statements,
 * `?view=unmatched`), Reviewed, Voided — on the title line with their counts. No strip and no notice on the page: the
 * figures are the tab counts and the toolbar's net waiting, and a blocked import is the disabled button's tooltip.
 */

// The (i) names the next step by its name on the rail (round 7: "Pay issues", not "Discrepancies").
const INFO = STATEMENT_EXPLAINER.replace("Discrepancies", "Pay issues");

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ import?: string; view?: string; carrier?: string }> }) {
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
  if (!actAsPagePermission(guard, "statements.view")) {
    return <RoleGateNotice featureLabel="Statements" detail="Carrier statements are imported and reviewed by the account owner or a bookkeeper. Accepted lines for your policies appear on the commission ledger." />;
  }

  const readOnly = guard.entitlement.access === "read_only";
  const tenantId = guard.context.tenantId;
  const [{ available, statements }, { import: importParam, view: viewParam, carrier }] = await Promise.all([listStatements(tenantId), searchParams]);
  const view = parseStatementsView(viewParam);
  const blocked = !available ? STATEMENT_SCHEMA_PENDING_MESSAGE : readOnly ? "Importing is paused while the account is read-only." : null;
  const [unmatched, waitingCents, carriers, savedMappings]: [Awaited<ReturnType<typeof listUnmatchedLines>> | null, Record<string, number>, StatementCarrierOption[], Record<string, StatementMapping>] = await Promise.all([
    view === "unmatched" && available ? listUnmatchedLines(tenantId) : Promise.resolve(null),
    view !== "unmatched" && available ? listWaitingCents(tenantId) : Promise.resolve({}),
    blocked ? Promise.resolve([]) : listStatementCarriers(tenantId),
    blocked ? Promise.resolve({}) : getSavedStatementMappings(tenantId),
  ]);
  // A blocked import says why on hover only (board 1·4): no notice on the page.
  const importControl = blocked ? (
    <Button type="button" disabled title={blocked}>Import a statement</Button>
  ) : (
    <StatementImportButton carriers={carriers} savedMappings={savedMappings} autoOpen={importParam === "1"} />
  );

  const counts = statementViewCounts(statements);
  // LA-4.2: PDFs stored and waiting for a person to type their lines in sit on To review.
  const toType = statements.filter((statement) => statement.status === "awaiting_entry").length;
  const leftUnmatchedCount = statements.filter((statement) => statement.status !== "voided").reduce((total, statement) => total + statement.counts.leftUnmatched, 0);
  const shown = view === "unmatched" ? [] : statementsOn(statements, view);
  const empty = !available
    ? { title: "Statements are not available yet", hint: STATEMENT_SCHEMA_PENDING_MESSAGE }
    : statements.length === 0
      ? { title: "No statement imported yet", hint: "Import a carrier's commission statement as CSV, Excel or PDF to review its lines." }
      : view === "review"
        ? { title: "Nothing to review", hint: "Every line on every statement is decided. Import the next carrier statement when it arrives." }
        : view === "reviewed"
          ? { title: "No statement reviewed yet", hint: "A statement moves here once no line on it waits for a person." }
          : { title: "No statement voided", hint: "A voided statement is kept here with its reason; its lines no longer post." };

  return (
    <CommissionsPage
      step="statements"
      info={INFO}
      actions={importControl}
      tabs={
        <ViewTabs
          label="Statements"
          value={view}
          tabs={STATEMENT_VIEWS.map((item) => ({
            key: item.key,
            label: item.label,
            count: counts[item.key],
            href: statementsViewHref(item.key),
            srSuffix: item.key === "review" && toType ? `(${toType} ${toType === 1 ? "PDF" : "PDFs"} to type in)` : undefined,
          }))}
        />
      }
    >
      {view === "unmatched" ? (
        <UnmatchedLinesTable lines={unmatched?.lines ?? []} leftUnmatchedCount={leftUnmatchedCount} canWrite={!readOnly} writeBlockedReason={readOnly ? "Re-matching is paused while the account is read-only." : null} />
      ) : (
        <StatementsTable
          key={view}
          statements={shown}
          view={view}
          waitingCents={waitingCents}
          initialCarrier={carrier ?? ""}
          readOnly={readOnly}
          emptyTitle={empty.title}
          emptyHint={empty.hint}
          emptyAction={view === "review" && !blocked ? <StatementImportButton carriers={carriers} savedMappings={savedMappings} /> : undefined}
        />
      )}
    </CommissionsPage>
  );
}

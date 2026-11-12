import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { StatementManualEntry } from "@/components/app/statement-manual-entry";
import { StatementActions, StatementReview } from "@/components/app/statement-review";
import { statementTabCount } from "@/components/app/commissions/statements/list-order";
import { StatementFileRows } from "@/components/app/commissions/statements/statement-file-rows";
import { STATEMENT_PRIMARY_SLOT } from "@/components/app/commissions/statements/slots";
import {
  STATEMENT_VIEWS, parseStatementTab, parseStatementsView, statementHref, statementName, statementNeighbours, statementSpan, statementTabOf, statementsOn, statementsViewHref,
  type StatementTab, type StatementsView,
} from "@/components/app/commissions/statements/list-order";
import { StepSlotTarget } from "@/components/app/step-frame/step-slot";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { COMMISSIONS_STEPS } from "@/lib/commissions/steps";
import { STATEMENT_SCHEMA_PENDING_MESSAGE, isRecordId, statementDay, statementMoney, statementPeriod, type StatementSummary } from "@/lib/ledger/statementConstants";
import { getStatementDetail, listStatements } from "@/lib/ledger/statementService";

/**
 * One carrier statement, and the review that posts its lines (round 7, owner pick 1·A, 2026-11-10;
 * docs/la4/mockups-r7/commissions.html boards 1·1–1·4).
 *
 * The title is the statement alone ("American Amicable · Oct 2026"), its tabs beside it — Waiting · Accepted ·
 * Set aside · The file — then ‹ › naming the previous and next statement in the list it was opened from
 * (`?from=`, the list's tab; else the tab this statement sits on), the primary (the next undecided line, filled by
 * the review through a StepSlot) and ⋯ (Original file · Re-process · Void statement). Under the title a strip: the
 * net on the statement, what waits, what posted, the file and the period, each a link. Nothing under the title and
 * no notice on the page: a voided statement says so in the strip's first cell.
 *
 * LA-4.1: the original file opens from ⋯. LA-4.2: a PDF statement waits for its lines, and this page's one tab,
 * "Type the lines", is where they are typed in beside the PDF. LA-4.3: a statement read from a stored CSV or
 * workbook can be re-processed; one that was says which statement it replaced.
 */
const TAB_LABELS: Record<StatementTab, string> = { waiting: "Waiting", accepted: "Accepted", aside: "Set aside", file: "The file" };
const n = (value: number) => value.toLocaleString("en-US");
const nameOf = (statement: Pick<StatementSummary, "carrierName" | "periodStart" | "periodEnd">) => statementName(statement.carrierName, statementPeriod(statement.periodStart, statement.periodEnd));

export default async function StatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; from?: string; line?: string }> }) {
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Statements" description="Import carrier commission statements, match each line to a policy, and post accepted lines to the commission ledger." />;
  }
  if (!actAsPagePermission(guard, "statements.view")) {
    return <RoleGateNotice featureLabel="Statements" detail="Carrier statements are imported and reviewed by the account owner or a bookkeeper." />;
  }

  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!isRecordId(id)) notFound();
  const tenantId = guard.context.tenantId;
  const [{ available, detail }, list] = await Promise.all([getStatementDetail(tenantId, id), listStatements(tenantId)]);
  const commissions = { label: "Commissions", href: COMMISSIONS_STEPS[0].href };

  if (!available) {
    return (
      <CommissionsPage step="statements" title="Statement" breadcrumbs={[commissions, { label: "Statements", href: "/app/statements" }, { label: "Statement" }]}>
        <TableCard><EmptyState title="Statements are not available yet" hint={STATEMENT_SCHEMA_PENDING_MESSAGE} /></TableCard>
      </CommissionsPage>
    );
  }
  if (!detail) notFound();

  const { statement, lines, policies, carrier } = detail;
  const readOnly = guard.entitlement.access === "read_only";
  const voided = statement.status === "voided";
  const awaitingEntry = statement.status === "awaiting_entry";
  const canWrite = !readOnly && !voided;
  const name = nameOf(statement);

  // The list it came from; a statement opened from elsewhere walks the tab it sits on.
  const from: StatementsView = query.from ? parseStatementsView(query.from) : statementTabOf(statement);
  const { previous, next } = statementNeighbours(statementsOn(list.statements, from), statement.id);
  const tab: StatementTab = awaitingEntry ? "waiting" : parseStatementTab(query.tab);
  const listHref = statementsViewHref(from);
  const here = (t: StatementTab) => statementHref(statement.id, from, { tab: t });

  const stepper = (
    <>
      {previous
        ? <Link href={statementHref(previous.id, from)} className={`${buttonVariants({ variant: "outline" })} max-w-[260px]`} title={`Previous statement: ${nameOf(previous)}`}><ChevronLeft aria-hidden="true" /><span className="truncate">{nameOf(previous)}</span></Link>
        : <Button type="button" variant="outline" disabled title={`The first statement on ${STATEMENT_VIEWS.find((view) => view.key === from)?.label ?? "the list"}`}><ChevronLeft aria-hidden="true" />None before</Button>}
      {next
        ? <Link href={statementHref(next.id, from)} className={`${buttonVariants({ variant: "outline" })} max-w-[260px]`} title={`Next statement: ${nameOf(next)}`}><span className="truncate">{nameOf(next)}</span><ChevronRight aria-hidden="true" /></Link>
        : <Button type="button" variant="outline" disabled title={`The last statement on ${STATEMENT_VIEWS.find((view) => view.key === from)?.label ?? "the list"}`}>None after<ChevronRight aria-hidden="true" /></Button>}
    </>
  );
  const canReprocess = statement.hasFile && statement.fileKind !== "pdf" && statement.headers.length > 0;
  const actions = (
    <span className="inline-flex flex-wrap items-center gap-2">
      {stepper}
      <StepSlotTarget id={STATEMENT_PRIMARY_SLOT} />
      <StatementActions statementId={statement.id} canWrite={!readOnly} voided={voided} hasFile={statement.hasFile} reprocess={canReprocess && !awaitingEntry ? { headers: statement.headers, mapping: statement.mapping } : null} />
    </span>
  );

  const tabs = awaitingEntry ? (
    <ViewTabs label={name} value="type" tabs={[{ key: "type", label: "Type the lines", href: statementHref(statement.id, from) }]} />
  ) : (
    <ViewTabs label={name} value={tab} tabs={[
      { key: "waiting", label: TAB_LABELS.waiting, count: statementTabCount(lines, "waiting"), href: here("waiting") },
      { key: "accepted", label: TAB_LABELS.accepted, count: statementTabCount(lines, "accepted"), href: here("accepted") },
      { key: "aside", label: TAB_LABELS.aside, count: statementTabCount(lines, "aside"), tone: statement.counts.errors > 0 ? "danger" : undefined, href: here("aside") },
      { key: "file", label: TAB_LABELS.file, href: here("file") },
    ]} />
  );

  // The strip (board 1·1): what the facts line said, as figures, each a link. A voided statement says so first.
  const kindLabel = statement.fileKind === "pdf" ? "PDF" : statement.fileKind === "xlsx" ? `Excel${statement.sheetName ? `, sheet “${statement.sheetName}”` : ""}` : "CSV";
  const waiting = statement.counts.proposed + statement.counts.unmatched;
  const strip = (
    <StatStrip label={`${name} at a glance`}>
      {voided && (
        <StatTile label="Voided" valueSize="text" value={statement.voidedAt ? `Voided ${statementDay(statement.voidedAt)}` : "Voided"}
          footnote={<span title={statement.voidReason ?? undefined}><StatusChip tone="danger">{statement.voidedByName ? `By ${statement.voidedByName}` : "By a former member"}</StatusChip>{statement.voidReason ? ` “${statement.voidReason}”` : ""}</span>} />
      )}
      <StatTile label="Net on the statement" value={statementMoney(statement.statementCents)} href={here("file")}
        footnote={awaitingEntry ? "lines not typed in yet" : statement.statementCents < 0 ? <StatusChip tone="danger">{`${n(statement.counts.lines)} ${statement.counts.lines === 1 ? "line" : "lines"}`}</StatusChip> : `${n(statement.counts.lines)} ${statement.counts.lines === 1 ? "line" : "lines"}`} />
      {!voided && (
        <StatTile label="Waiting" value={n(waiting)} href={awaitingEntry ? undefined : here("waiting")}
          footnote={awaitingEntry ? "type the lines in first" : waiting > 0 ? <StatusChip tone="warning">{`${n(statement.counts.proposed)} proposed · ${n(statement.counts.unmatched)} no match`}</StatusChip> : `${n(statement.counts.proposed)} proposed · ${n(statement.counts.unmatched)} no match`} />
      )}
      <StatTile label="Posted to the ledger" value={statementMoney(voided ? 0 : statement.acceptedCents)} href="/app/ledger"
        footnote={voided ? `${statementMoney(statement.acceptedCents)} no longer posts · Commission ledger ›` : "Commission ledger ›"} />
      <StatTile label="File" valueSize="text" value={<span title={statement.fileName}>{statement.fileName}</span>}
        footnote={<>{kindLabel} · {statementDay(statement.uploadedAt)} · {statement.uploadedByName ?? "a former member"}{statement.reprocessedFrom && <> · <Link className="hover:underline" href={statementHref(statement.reprocessedFrom, "voided")} title="Re-processed from the stored file of an earlier import, which is voided and kept">re-processed from an earlier import</Link></>}</>} />
      <StatTile label="Period" valueSize="text" value={statementSpan(statement.periodStart, statement.periodEnd)}
        href={statementsViewHref(from === "unmatched" ? "review" : from, { carrier: statement.carrierId })} footnote={`${statement.carrierName}'s statements ›`} />
    </StatStrip>
  );

  return (
    <CommissionsPage
      step="statements"
      title={name}
      breadcrumbs={[commissions, { label: "Statements", href: listHref }, { label: name }]}
      tabs={tabs}
      actions={actions}
    >
      {strip}
      {awaitingEntry ? (
        <StatementManualEntry statementId={statement.id} canWrite={!readOnly} slotId={STATEMENT_PRIMARY_SLOT} />
      ) : tab === "file" ? (
        <StatementFileRows lines={lines} headers={statement.headers} mapping={statement.mapping} typed={lines.length > 0 && lines.every((line) => line.entrySource === "manual")} />
      ) : (
        <StatementReview
          key={tab}
          statementId={statement.id}
          lines={lines}
          policies={policies}
          carrier={carrier}
          tab={tab}
          voided={voided}
          canWrite={canWrite}
          initialLineId={query.line ?? null}
          slotId={STATEMENT_PRIMARY_SLOT}
        />
      )}
    </CommissionsPage>
  );
}

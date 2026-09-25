import Link from "next/link";
import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { StatementReview } from "@/components/app/statement-review";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import { STATEMENT_SCHEMA_PENDING_MESSAGE, isRecordId, statementDay, statementMoney, statementPeriod } from "@/lib/ledger/statementConstants";
import { getStatementDetail } from "@/lib/ledger/statementService";
import { sectionForPath } from "@/lib/menu/definition";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";

/**
 * One carrier statement, and the review that posts its lines. The header says where the file came
 * from and who brought it in; the table below is where every ledger entry gets the name of the
 * person who accepted it.
 */
export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const eyebrow = sectionForPath("/app/statements") ?? undefined;
  const guard = await guardPage("statement_ingestion");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Statements" eyebrow={eyebrow} description="Import carrier commission statements, match each line to a policy, and post accepted lines to the commission ledger." />;
  }
  if (!hasTenantPermission(guard.role, "statements.view")) {
    return <RoleGateNotice featureLabel="Statements" eyebrow={eyebrow} detail="Carrier statements are imported and reviewed by the account owner or a bookkeeper." />;
  }

  const { id } = await params;
  if (!isRecordId(id)) notFound();
  const { available, detail } = await getStatementDetail(guard.context.tenantId, id);
  const back = <Button asChild type="button" variant="ghost" className="h-11 px-4"><Link href="/app/statements">All statements</Link></Button>;

  if (!available) {
    return (
      <div className="m-stagger flex flex-col gap-6">
        <PageHeader eyebrow={eyebrow} title="Statement" actions={back} />
        <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
          <p className="font-semibold text-[var(--warning-ink)]">Statements are not available yet</p>
          <p className="mt-1.5 text-[var(--body)]">{STATEMENT_SCHEMA_PENDING_MESSAGE}</p>
        </div>
      </div>
    );
  }
  if (!detail) notFound();

  const { statement, lines, policies, carrier } = detail;
  const readOnly = guard.entitlement.access === "read_only";
  const voided = statement.status === "voided";
  const waiting = statement.counts.proposed + statement.counts.unmatched;

  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader
        eyebrow={eyebrow}
        title={`${statement.carrierName} · ${statementPeriod(statement.periodStart, statement.periodEnd)}`}
        description={`${statement.fileName} · imported ${statementDay(statement.uploadedAt)}${statement.uploadedByName ? ` by ${statement.uploadedByName}` : ""} · ${statement.rowCount.toLocaleString("en-US")} ${statement.rowCount === 1 ? "line" : "lines"}`}
        actions={back}
      />

      {voided && (
        <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
          <p className="font-semibold text-[var(--error-ink)]">Voided{statement.voidedAt ? ` ${statementDay(statement.voidedAt)}` : ""}{statement.voidedByName ? ` by ${statement.voidedByName}` : ""}</p>
          <p className="mt-1.5 text-[var(--body)]">&ldquo;{statement.voidReason}&rdquo; Its lines no longer post to the commission ledger. The statement, its lines and its matches are kept as they were.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Lines" value={statement.counts.lines.toLocaleString("en-US")} footnote={`${statementMoney(statement.statementCents)} net on the statement`} />
        <StatTile label="Waiting" value={waiting.toLocaleString("en-US")} footnote={voided ? "voided: nothing to decide" : `${statement.counts.proposed.toLocaleString("en-US")} proposed · ${statement.counts.unmatched.toLocaleString("en-US")} without a match`} />
        <StatTile label="Accepted" value={statement.counts.accepted.toLocaleString("en-US")} valueTone={statement.counts.accepted > 0 && !voided ? "good" : undefined} footnote={voided ? `${statementMoney(statement.acceptedCents)} no longer posted` : `${statementMoney(statement.acceptedCents)} posted to the ledger`} />
        <StatTile label="Set aside" value={(statement.counts.leftUnmatched + statement.counts.errors).toLocaleString("en-US")} footnote={`${statement.counts.leftUnmatched.toLocaleString("en-US")} left unmatched · ${statement.counts.errors.toLocaleString("en-US")} could not be read`} />
      </div>

      <StatementReview
        statementId={statement.id}
        lines={lines}
        policies={policies}
        carrier={carrier}
        voided={voided}
        canWrite={!readOnly && !voided}
        writeBlockedReason={readOnly ? "Reading remains available; decisions are paused while the account is read-only." : null}
      />
    </div>
  );
}

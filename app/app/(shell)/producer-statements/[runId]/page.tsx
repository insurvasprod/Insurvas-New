import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { readStatement } from "@/lib/agency/ledgerStore";
import { buildStatement } from "@/lib/agency/statementCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatementView } from "@/components/app/agency/statement-view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * AG-1.8 · one producer statement. The same rules as its API (/api/app/agency/statements/<run>): the producer opens
 * his own (another's is "not found"), the owner, an admin and the bookkeeper any; a manager never (production, not
 * pay). Read on the server, so the header is compact from the first paint: the period as the title, the producer,
 * the agency and how it was paid as one line of facts, Download PDF.
 *
 * Owner and bookkeeper: a record of Accounting › Producer payouts (2026-11-03). A producer reaches it from My pay,
 * so his trail says Commissions › My pay.
 */
export default async function ProducerStatementPage({ params }: { params: Promise<{ runId: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Statements" description="What each producer earned and what was taken back." />;
  if (!actAsPage(guard, ["owner", "bookkeeper", "producer"])) return <RoleGateNotice featureLabel="Statements" detail="Producers open their own statements; the owner, admins and the bookkeeper open any." />;
  const { runId } = await params;
  if (!UUID.test(runId)) notFound();
  const data = await readStatement(guard.context.tenantId, runId);
  if (!data) notFound();
  const keeper = actAsPage(guard, ["owner", "bookkeeper"]);
  if (!keeper && data.run.producerUserId !== guard.context.userId) notFound();
  if (guard.context.memberRole === "manager" && data.run.producerUserId !== guard.context.userId) notFound();
  const statement = buildStatement(data.before, data.during, "reported");
  const title = `Statement · ${data.run.periodStart} to ${data.run.periodEnd}`;
  const paid = data.run.paidOn ? ` · paid ${data.run.paidOn}${data.run.method ? ` by ${data.run.method}` : ""}${data.run.reference ? ` (${data.run.reference})` : ""}` : " · nothing paid";
  const facts = `${data.producer} · ${data.agency}${paid}`;
  const pdf = <Button asChild variant="outline"><a href={`/api/app/agency/statements/${runId}?format=pdf`} download>Download PDF</a></Button>;
  const body = <StatementView run={{ withheldCents: data.run.withheldCents, decisionReason: data.run.decisionReason }} statement={statement} />;
  if (keeper) return <AccountingPage step="producerPayouts" title={title} facts={facts} actions={pdf}>{body}</AccountingPage>;
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title={title} meta={<p className="mt-1 text-sm text-muted-foreground">{facts}</p>} actions={pdf} breadcrumbs={[{ label: "Commissions" }, { label: "My pay", href: "/app/my-pay" }, { label: title }]} />
      {body}
    </div>
  );
}

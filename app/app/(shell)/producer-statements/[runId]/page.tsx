import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { StatementView } from "@/components/app/agency/statement-view";

/**
 * AG-1.8 · one producer statement. The API decides who may open it: the producer his own (another's is "not found"),
 * the owner, an admin and the bookkeeper any; a manager never (production, not pay).
 */
export default async function ProducerStatementPage({ params }: { params: Promise<{ runId: string }> }) {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Statements" description="What each producer earned and what was taken back." />;
  if (!actAsPage(guard, ["owner", "bookkeeper", "producer"])) return <RoleGateNotice featureLabel="Statements" detail="Producers open their own statements; the owner, admins and the bookkeeper open any." />;
  const { runId } = await params;
  return <StatementView runId={runId} />;
}

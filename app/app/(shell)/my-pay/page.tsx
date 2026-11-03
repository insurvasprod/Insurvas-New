import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ProducerMoneyTab } from "@/components/app/agency/producer-money-tab";
import { CommissionsPage } from "@/components/app/commissions/commissions-page";

/** AG-1.5 / AG-1.8 · Commissions › My pay: a producer's own balance, ledger and statements — no asking anyone. */
export default async function MyPayPage() {
  const guard = await guardPage("producer_payouts");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="My pay" description="What you earned, what came back, and every statement." />;
  if (!actAsPage(guard, ["producer"])) return <RoleGateNotice featureLabel="My pay" detail="My pay is a producer's own page. The owner sees everyone's pay under Payout runs." />;
  return (
    <CommissionsPage step="reconciliation" pathname="/app/my-pay">
      <ProducerMoneyTab url="/api/app/agency/my-pay" />
    </CommissionsPage>
  );
}

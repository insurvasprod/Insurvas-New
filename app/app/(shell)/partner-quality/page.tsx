import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { PartnerQualityWorkspace } from "@/components/app/partner-quality-workspace";
import { validPartnerQualityPeriod } from "@/lib/partnerQuality/metrics";
import { ReportsPage } from "@/components/app/reports/reports-page";

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function PartnerQualityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("partner_quality");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner quality" description="Compare lead quality and conversion across partners." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="Partner quality" detail="Owners, producers, and bookkeepers can review partner lead quality." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Partner quality" detail="In an agency, the owner and admins review partner quality." />;
  const query = await searchParams;
  // Reports round 7 (owner pick 8·A, 2026-11-11): the "Table · Chart" switch on the title line, the chart by default.
  // A row and a bar open the partner's page (/app/partner-quality/[partnerId]); its ⋯ opens the partner's record.
  return (
    <ReportsPage view="partner" show="chart" info="How good each partner's leads are: sent, with what was submitted inside, and the flags. A bar or a row opens the partner; a figure opens the leads it counted. Conversion is submitted ÷ sent. Quality and conversion only: cost is on True CPA.">
      <PartnerQualityWorkspace initialPeriod={validPartnerQualityPeriod(single(query.from), single(query.to))} framed />
    </ReportsPage>
  );
}

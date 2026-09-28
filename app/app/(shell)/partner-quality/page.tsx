import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PartnerQualityWorkspace } from "@/components/app/partner-quality-workspace";
import { validPartnerQualityPeriod } from "@/lib/partnerQuality/metrics";

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function PartnerQualityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("partner_quality");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner quality" description="Compare the quality and conversion of every partner's leads without cost data." />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Partner quality" detail="Owners, producers, and bookkeepers can review partner lead quality." />;
  const query = await searchParams;
  return <PartnerQualityWorkspace initialPeriod={validPartnerQualityPeriod(single(query.from), single(query.to))} />;
}

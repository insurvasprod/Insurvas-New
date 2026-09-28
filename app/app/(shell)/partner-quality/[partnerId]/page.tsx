import { notFound } from "next/navigation";

import { guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PartnerQualityDetailWorkspace } from "@/components/app/partner-quality-detail";
import { validPartnerQualityPeriod } from "@/lib/partnerQuality/metrics";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function PartnerQualityDetailPage({ params, searchParams }: { params: Promise<{ partnerId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("partner_quality");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner quality" description="Compare the quality and conversion of every partner's leads without cost data." />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="Partner quality" detail="Owners, producers, and bookkeepers can review partner lead quality." />;
  const [{ partnerId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(partnerId)) notFound();
  return <PartnerQualityDetailWorkspace partnerId={partnerId} initialPeriod={validPartnerQualityPeriod(single(query.from), single(query.to))} />;
}

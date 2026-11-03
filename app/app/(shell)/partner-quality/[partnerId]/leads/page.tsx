import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { PartnerQualityLeads } from "@/components/app/partner-quality-leads";
import { defaultPartnerQualityPeriod, validPartnerQualityPeriod } from "@/lib/partnerQuality/metrics";
import { PARTNER_QUALITY_METRICS, type PartnerQualityMetric } from "@/lib/partnerQuality/types";
import { ReportsPage } from "@/components/app/reports/reports-page";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

/**
 * Reports › Partner quality › a partner › the leads behind a figure (foundation pass 2026-11-03: the side
 * drawer as a page). The same gates as the partner's page; /api/app/partner-quality/leads applies them too.
 */
export default async function PartnerQualityLeadsPage({ params, searchParams }: { params: Promise<{ partnerId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("partner_quality");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner quality" description="Compare lead quality and conversion across partners." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="Partner quality" detail="Owners, producers, and bookkeepers can review partner lead quality." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Partner quality" detail="In an agency, the owner and admins review partner quality." />;
  const [{ partnerId }, query] = await Promise.all([params, searchParams]);
  const metric = single(query.metric) ?? "";
  if (!UUID.test(partnerId) || !PARTNER_QUALITY_METRICS.includes(metric as PartnerQualityMetric)) notFound();
  const period = validPartnerQualityPeriod(single(query.from), single(query.to)) ?? defaultPartnerQualityPeriod();
  const member = single(query.member);
  const label = (single(query.label) ?? "").slice(0, 160).trim() || "Leads behind this figure";
  return (
    <ReportsPage view="partner" title={label}>
      <PartnerQualityLeads partnerId={partnerId} metric={metric as PartnerQualityMetric} period={period} label={label} disposition={single(query.disposition)?.slice(0, 80) || null} member={member && UUID.test(member) ? member : null} />
    </ReportsPage>
  );
}

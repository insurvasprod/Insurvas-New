import { notFound } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { PartnerQualityDetailWorkspace } from "@/components/app/partner-quality-detail";
import { validPartnerQualityPeriod } from "@/lib/partnerQuality/metrics";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function PartnerQualityDetailPage({ params, searchParams }: { params: Promise<{ partnerId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("partner_quality");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner quality" description="Compare lead quality and conversion across partners." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="Partner quality" detail="Owners, producers, and bookkeepers can review partner lead quality." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Partner quality" detail="In an agency, the owner and admins review partner quality." />;
  const [{ partnerId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(partnerId)) notFound();
  // Partners A (2026-10-25): on the shell's stage (one per page, drawn by the layout).
  return <><PartnerQualityDetailWorkspace partnerId={partnerId} initialPeriod={validPartnerQualityPeriod(single(query.from), single(query.to))} /></>;
}

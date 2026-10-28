import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { PartnerQualityWorkspace } from "@/components/app/partner-quality-workspace";
import { validPartnerQualityPeriod } from "@/lib/partnerQuality/metrics";

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function PartnerQualityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("partner_quality");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Partner quality" description="Compare lead quality and conversion across partners." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="Partner quality" detail="Owners, producers, and bookkeepers can review partner lead quality." />;
  // AG-0.5: inside an agency this is the agency's business, not a producer's work — its API refuses a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Partner quality" detail="In an agency, the owner and admins review partner quality." />;
  const [query, records] = await Promise.all([searchParams, guardPage("publisher_records")]);
  // A row opens the partner record's Quality tab for someone who may open partner records.
  const recordLinks = records.entitled && actAsPage(records, ["owner", "bookkeeper"]);
  // Partners A (2026-10-25): on the shell's stage (one per page, drawn by the layout).
  return <><PartnerQualityWorkspace initialPeriod={validPartnerQualityPeriod(single(query.from), single(query.to))} recordLinks={recordLinks} /></>;
}

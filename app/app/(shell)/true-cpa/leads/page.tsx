import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TrueCpaLeads } from "@/components/app/true-cpa-leads";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { readTrueCpaLeads } from "@/lib/reports/trueCpaLeads";

/**
 * Reports › True CPA › the leads behind a figure (foundation pass 2026-11-03: a page, not a side panel).
 * The same gate as True CPA; /api/app/true-cpa/leads applies it again and reads the same scope.
 */
export default async function TrueCpaLeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardPage("true_cpa");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="True CPA" description="See what each vendor costs per issued policy." />;
  if (!actAsPage(guard, ["owner", "producer", "bookkeeper"])) return <RoleGateNotice featureLabel="True CPA" detail="Owners, producers, and bookkeepers can review vendor economics." />;
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="True CPA" detail="In an agency, the owner and admins handle true CPA." />;
  const { params, title } = readTrueCpaLeads(await searchParams);
  return (
    <ReportsPage view="cpa" title={title}>
      <TrueCpaLeads params={params} title={title} />
    </ReportsPage>
  );
}

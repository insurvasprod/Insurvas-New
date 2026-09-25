import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TrueCpaWorkspace } from "@/components/app/true-cpa-workspace";
import { guardPage } from "@/lib/entitlements/guardPage";
import { sectionForPath } from "@/lib/menu/definition";

export default async function TrueCpaPage() {
  const guard = await guardPage("true_cpa");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="True CPA" description="See what each vendor and campaign actually costs through an issued policy." eyebrow={sectionForPath("/app/true-cpa") ?? undefined} />;
  if (!["owner", "producer", "bookkeeper"].includes(guard.role)) return <RoleGateNotice featureLabel="True CPA" detail="Owners, producers, and bookkeepers can review vendor economics." eyebrow={sectionForPath("/app/true-cpa") ?? undefined} />;
  return <TrueCpaWorkspace />;
}

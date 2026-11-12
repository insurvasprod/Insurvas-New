import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { complaintPeople } from "@/lib/compliance/complaintPeople";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { NewComplaintForm } from "@/components/app/compliance/complaints-board";
import { RouteSheet } from "@/components/app/route-sheet";

/** Record a complaint, opened from inside the app: a panel from the right (route-sheet.tsx); the same gate as its page. */
export default async function NewComplaintSheet() {
  const title = "Record a complaint";
  const guard = await guardPage("tcpa_checker");
  if (!guard.entitled) return <RouteSheet title={title}><FeatureGateNotice guard={guard} featureLabel="Complaints" description="Every complaint with an owner, a deadline and a countdown." /></RouteSheet>;
  if (!actAsPage(guard, ["owner", "producer"])) return <RouteSheet title={title}><RoleGateNotice featureLabel="Complaints" detail="Only owners and producers can see consumer complaints." /></RouteSheet>;
  if ((await scopeFor(guard.context)) !== null) return <RouteSheet title={title}><RoleGateNotice reason="agency" featureLabel="Complaints" detail="In an agency, the owner and admins handle complaints." /></RouteSheet>;
  if (guard.entitlement.access === "read_only") return <RouteSheet title={title}><RoleGateNotice featureLabel="Complaints" detail="This plan is read-only here: complaints can be read, not recorded." /></RouteSheet>;
  const { team, partners } = await complaintPeople(guard.context.tenantId);
  return (
    <RouteSheet title={title}>
      <NewComplaintForm team={team} partners={partners} />
    </RouteSheet>
  );
}

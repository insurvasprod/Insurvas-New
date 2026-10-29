import { guardPage } from "@/lib/entitlements/guardPage";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { redirect } from "next/navigation";

import { LeadSourcesPage } from "@/components/app/lead-sources/pages";

/**
 * Lead sources: step 4 · Lists of the one Leads page (owner pick B, 2026-10-28). The old `?tab=campaigns`
 * and `?import=1` links go to their own steps, which keep their own gates.
 */
export default async function LeadSources({ searchParams }: { searchParams: Promise<{ tab?: string; import?: string }> }) {
  const [lists, outbound, returns] = await Promise.all([guardPage("lead_import"), guardPage("outbound_dialing"), guardPage("true_cpa")]);
  const guard = lists.entitled ? lists : outbound;
  // AG-0.5: inside an agency every tab here is the agency's business — their APIs refuse a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Lead sources" detail="In an agency, the owner and admins handle vendors, lists and lead spend." />;
  const { tab, import: importOpen } = await searchParams;
  if (tab === "campaigns") redirect("/app/campaigns");
  if (importOpen === "1") redirect("/app/import");
  return <LeadSourcesPage guards={{ lists, outbound, returns }} />;
}

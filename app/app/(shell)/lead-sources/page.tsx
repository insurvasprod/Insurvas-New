import { guardPage } from "@/lib/entitlements/guardPage";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { LeadSourcesPage } from "@/components/app/lead-sources/pages";

/**
 * Lead sources (2026-10-26): Lead lists, Vendors & campaigns and List import as one page.
 * `?tab=campaigns`, `?import=1`. Each tab keeps its old page's plan and role gate (LeadSourcesPage).
 */
export default async function LeadSources({ searchParams }: { searchParams: Promise<{ tab?: string; import?: string }> }) {
  const [lists, outbound, returns] = await Promise.all([guardPage("lead_import"), guardPage("outbound_dialing"), guardPage("true_cpa")]);
  const guard = lists.entitled ? lists : outbound;
  // AG-0.5: inside an agency every tab here is the agency's business — their APIs refuse a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Lead sources" detail="In an agency, the owner and admins handle vendors, lists and lead spend." />;
  const { tab, import: importOpen } = await searchParams;
  return <LeadSourcesPage tab={tab === "campaigns" ? "campaigns" : "lists"} importOpen={importOpen === "1"} guards={{ lists, outbound, returns }} />;
}

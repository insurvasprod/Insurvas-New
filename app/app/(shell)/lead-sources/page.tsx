import { guardPage } from "@/lib/entitlements/guardPage";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { scopeFor } from "@/lib/agency/visibility";
import { redirect } from "next/navigation";

/**
 * Lead sources (the menu entry) opens Source: there is no Lists page any more (manager 2026-10-29). The
 * old `?tab=campaigns` and `?import=1` links go to their own pages, which keep their own gates.
 */
export default async function LeadSources({ searchParams }: { searchParams: Promise<{ tab?: string; import?: string }> }) {
  const [lists, outbound] = await Promise.all([guardPage("lead_import"), guardPage("outbound_dialing")]);
  const guard = lists.entitled ? lists : outbound;
  // AG-0.5: inside an agency every tab here is the agency's business — their APIs refuse a narrow session too.
  if ((await scopeFor(guard.context)) !== null) return <RoleGateNotice reason="agency" featureLabel="Lead flow" detail="In an agency, the owner and admins handle vendors, lists and lead spend." />;
  const { tab, import: importOpen } = await searchParams;
  if (tab === "campaigns") redirect("/app/campaigns");
  if (importOpen === "1") redirect("/app/import");
  // No Lists page (manager 2026-10-29): a campaign holds its lists, on Source.
  redirect("/app/campaigns");
}

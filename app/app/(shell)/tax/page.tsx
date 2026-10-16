import { guardPage } from "@/lib/entitlements/guardPage";
import { categoryMap, categoryTotals, contractors, TaxError, taxSettings } from "@/lib/accounting/taxStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TaxBoard, TaxNotice, type TaxData } from "@/components/app/accounting/tax-board";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";

/**
 * Money › Tax summaries (LA-7.8, Notion sprint). 1099 figures and the year by category. Figures
 * from recorded transactions — not tax advice; nothing is filed. Owner and bookkeeper only.
 */
export default async function TaxPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const guard = await guardPage("tax_summaries");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Tax summaries" description="What the accountant asks for, from your records." />;
  }
  if (!["owner", "bookkeeper"].includes(guard.role)) {
    return <RoleGateNotice featureLabel="Tax summaries" detail="Only owners and bookkeepers can see the agency's tax figures." />;
  }
  const q = await searchParams;
  const year = /^\d{4}$/.test(q.year ?? "") ? Number(q.year) : new Date().getUTCFullYear();
  const tenantId = guard.context.tenantId;
  let data: TaxData | null = null;
  let problem: string | null = null;
  try {
    const settings = await taxSettings(tenantId);
    const [people, totals, map] = await Promise.all([contractors(tenantId, year), categoryTotals(tenantId, year, settings.basis), categoryMap(tenantId)]);
    data = { year, basis: settings.basis, canReveal: settings.viewerRoles.includes(guard.role), contractors: people, totals, map };
  } catch (error) {
    if (!(error instanceof TaxError)) throw error;
    problem = error.message;
  }
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Tax summaries" description="1099 figures and the year by category, from your records." />
      {data ? <TaxBoard data={data} readOnly={guard.entitlement.access === "read_only"} /> : <><TaxNotice /><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></>}
    </div>
  );
}

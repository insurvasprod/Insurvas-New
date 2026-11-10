import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { categoryMap, categoryTotals, contractors, TaxError, taxSettings } from "@/lib/accounting/taxStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TaxBoard, TaxNotice, type TaxData, type TaxView } from "@/components/app/accounting/tax-board";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Tax summaries (LA-7.8, Notion sprint). 1099 figures and the year by category. Figures
 * from recorded transactions — not tax advice; nothing is filed. Owner and bookkeeper only.
 *
 * Foundation pass (2026-11-03): Contractors · By category · Buckets are the step's tabs on the title line
 * (`?view=`); the export is the header's Download (XLSX) with the three CSV sheets in More. The notice
 * stays on screen on every view, including when the page cannot load.
 */
const VIEWS: TaxView[] = ["contractors", "categories", "buckets"];

export default async function TaxPage({ searchParams }: { searchParams: Promise<{ year?: string; view?: string }> }) {
  const guard = await guardPage("tax_summaries");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Tax summaries" description="What the accountant asks for, from your records." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Tax summaries" detail="Only owners and bookkeepers can see the agency's tax figures." />;
  }
  const q = await searchParams;
  const year = /^\d{4}$/.test(q.year ?? "") ? Number(q.year) : new Date().getUTCFullYear();
  const view = VIEWS.find((v) => v === q.view) ?? "contractors";
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
  const exportHref = (format: "xlsx" | "csv", sheet?: string) => `/api/app/accounting/tax/export?year=${year}&format=${format}${sheet ? `&sheet=${sheet}` : ""}`;
  const at = (v: TaxView) => `/app/tax?year=${year}${v === "contractors" ? "" : `&view=${v}`}`;
  return (
    <AccountingPage
      step="tax"
      info="Contractors are counted by the date money moved, in the calendar year. By category follows your P&L's basis. The export is a summary of recorded transactions for your accountant, not a tax return; nothing is filed."
      tabs={data ? <ViewTabs label="Tax summaries" value={view} tabs={[
        { key: "contractors", label: "Contractors", count: data.contractors.missingCount || null, tone: "danger", href: at("contractors") },
        { key: "categories", label: "By category", href: at("categories") },
        { key: "buckets", label: "Buckets", href: at("buckets") },
      ]} /> : undefined}
      actions={data ? <>
        <MoreMenu items={[
          { label: "Totals by category (CSV)", href: exportHref("csv", "totals") },
          { label: "Every transaction (CSV)", href: exportHref("csv", "transactions") },
          { label: "Contractor payments (CSV)", href: exportHref("csv", "contractors") },
        ]} />
        <Button asChild><a href={exportHref("xlsx")} download>Download {year} (XLSX)</a></Button>
      </> : undefined}
    >
      {data ? <TaxBoard key={view} data={data} view={view} readOnly={guard.entitlement.access === "read_only"} /> : <TableCard footer={<TaxNotice />}><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </AccountingPage>
  );
}

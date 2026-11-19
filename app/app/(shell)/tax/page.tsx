import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { categoryMap, categoryQuarters, contractors, TaxError, taxSettings } from "@/lib/accounting/taxStore";
import { payeeHref, whoOf, whoRows } from "@/lib/accounting/taxLinks";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { TaxBoard, TaxNotice, type TaxData, type TaxView } from "@/components/app/accounting/tax-board";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Tax summaries (LA-7.8, Notion sprint). 1099 figures and the year by category. Figures
 * from recorded transactions — not tax advice; nothing is filed. Owner and bookkeeper only.
 *
 * Round 7 (owner 2026-11-10, mockups-r7/accounting.html §6 · A): Contractors · By category · Buckets are the step's
 * tabs on the title line (`?view=`), the Contractors chip is `?who=`. The title line holds ⋯ (the three CSVs),
 * "Add N missing details" (the first payee missing something; their page's ‹ › walk the rest) and Download (XLSX).
 * The notice stays on screen on every view, including when the page cannot load.
 */
const VIEWS: TaxView[] = ["contractors", "categories", "buckets"];

export default async function TaxPage({ searchParams }: { searchParams: Promise<{ year?: string; view?: string; who?: string }> }) {
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
  const who = whoOf(q.who);
  const tenantId = guard.context.tenantId;
  const role = guard.role;
  // Frame first (UI-CONSISTENCY §7a): the year's figures are read now; the title, the three tabs and the exports draw at
  // once, the counts and "Add N missing details" when the figures land.
  const read: TaxRead = (async () => {
    try {
      const settings = await taxSettings(tenantId);
      const [people, categories, map] = await Promise.all([contractors(tenantId, year), categoryQuarters(tenantId, year, settings.basis), categoryMap(tenantId)]);
      return { data: { year, basis: settings.basis, canReveal: settings.viewerRoles.includes(role), contractors: people, categories, map }, problem: null };
    } catch (error) {
      if (!(error instanceof TaxError)) throw error;
      return { data: null, problem: error.message };
    }
  })();
  const exportHref = (format: "xlsx" | "csv", sheet?: string) => `/api/app/accounting/tax/export?year=${year}&format=${format}${sheet ? `&sheet=${sheet}` : ""}`;
  const at = (v: TaxView) => `/app/tax?year=${year}${v === "contractors" ? "" : `&view=${v}`}`;
  const tabsOf = (missing: number | null) => (
    <ViewTabs label="Tax summaries" value={view} tabs={[
      { key: "contractors", label: "Contractors", count: missing || null, tone: "danger", href: at("contractors") },
      { key: "categories", label: "By category", href: at("categories") },
      { key: "buckets", label: "Buckets", href: at("buckets") },
    ]} />
  );
  const actionsOf = (missing: ReactNode) => (
    <>
      <MoreMenu items={[
        { label: "Totals by category (CSV)", href: exportHref("csv", "totals") },
        { label: "Every transaction (CSV)", href: exportHref("csv", "transactions") },
        { label: "Contractor payments (CSV)", href: exportHref("csv", "contractors") },
      ]} />
      {missing}
      <Button asChild><a href={exportHref("xlsx")} download>Download {year} (XLSX)</a></Button>
    </>
  );
  return (
    <AccountingPage
      step="tax"
      info="Contractors are counted by the date money moved, in the calendar year. By category follows your P&L's basis, by calendar quarter. The export is a summary of recorded transactions for your accountant, not a tax return; nothing is filed."
      tabs={<Suspense fallback={tabsOf(null)}><TaxTabs read={read} tabsOf={tabsOf} /></Suspense>}
      actions={<Suspense fallback={actionsOf(null)}><TaxActions read={read} year={year} actionsOf={actionsOf} /></Suspense>}
    >
      <StreamSection shape="strip+table">
        <TaxBody read={read} view={view} who={who} readOnly={guard.entitlement.access === "read_only"} />
      </StreamSection>
    </AccountingPage>
  );
}

type TaxRead = Promise<{ data: TaxData | null; problem: string | null }>;

async function TaxTabs({ read, tabsOf }: { read: TaxRead; tabsOf: (missing: number | null) => ReactNode }) {
  const { data } = await read;
  return data ? tabsOf(data.contractors.missingCount) : null;
}

async function TaxActions({ read, year, actionsOf }: { read: TaxRead; year: number; actionsOf: (missing: ReactNode) => ReactNode }) {
  const { data } = await read;
  if (!data) return null;
  const firstMissing = whoRows(data.contractors, "missing")[0];
  return actionsOf(firstMissing ? <Button variant="outline" asChild><Link href={payeeHref(firstMissing, year, { from: "missing" })}>Add {data.contractors.missingCount} missing {data.contractors.missingCount === 1 ? "detail" : "details"}</Link></Button> : null);
}

async function TaxBody({ read, view, who, readOnly }: { read: TaxRead; view: TaxView; who: ReturnType<typeof whoOf>; readOnly: boolean }) {
  const { data, problem } = await read;
  return data ? <TaxBoard key={`${view}-${who}`} data={data} view={view} who={who} readOnly={readOnly} /> : <TableCard footer={<TaxNotice />}><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
}

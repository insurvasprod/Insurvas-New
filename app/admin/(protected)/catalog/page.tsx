import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WsPanelLoading } from "@/components/admin/billing/ws-panel";
import { CatalogPage } from "@/components/admin/catalog/catalog-page";
import { CatalogWsFigures, CatalogWsFiguresLoading, CatalogWsNeeds, CatalogWsRecent, CatalogWsSwitches } from "@/components/admin/catalog/ws-sections";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { catalogStepsFor } from "@/lib/adminCatalog/steps";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";

/**
 * Admin › Catalog workspace (admin round 1, docs/design/admin-r1/catalog.html screen 1): what needs review, what's
 * live and what changed lately, in one place. The figures, Needs review (each queue the role's pages already count,
 * opening its page filtered), the switches that are not plain on, and recent catalog changes from the audit log.
 * Each part streams and fails on its own; the rail and the title show at once.
 *
 * Open to any admin whose menu offers Catalog (lib/adminCatalog/steps.ts); a role sees only the queues and figures
 * of the pages it may open (platform config: no plan, add-on or pricing figures).
 */
export default async function CatalogWorkspacePage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  const steps = catalogStepsFor(admin.role);
  if (!steps.some((step) => step.key === "workspace")) redirect("/admin");
  const viewer = { id: admin.id, role: admin.role };
  const plans = steps.some((step) => step.key === "plans");

  return (
    <CatalogPage
      step="workspace"
      title="Catalog"
      info="What we sell and what we know about carriers: what waits for review, what's switched off, and what changed lately."
      actions={
        <>
          {canOpenAdminHref(admin.role, "/admin/audit-log") && <Link href="/admin/audit-log" className={buttonVariants({ variant: "outline" })}>Open Audit Log</Link>}
          {plans && <Link href="/admin/plans?new=1" className={buttonVariants()}>New Plan</Link>}
        </>
      }
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <Suspense fallback={<CatalogWsFiguresLoading role={admin.role} />}>
          <CatalogWsFigures viewer={viewer} />
        </Suspense>
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <Suspense fallback={<WsPanelLoading title="Needs review" rows={7} />}>
            <CatalogWsNeeds viewer={viewer} />
          </Suspense>
          <div className="flex min-w-0 flex-col gap-4">
            {steps.some((step) => step.key === "features") && (
              <Suspense fallback={<WsPanelLoading title="Switches" rows={2} />}>
                <CatalogWsSwitches />
              </Suspense>
            )}
            <Suspense fallback={<WsPanelLoading title="Recent changes" rows={5} />}>
              <CatalogWsRecent viewer={viewer} />
            </Suspense>
          </div>
        </div>
      </div>
    </CatalogPage>
  );
}

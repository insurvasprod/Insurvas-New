import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WsPanelLoading } from "@/components/admin/billing/ws-panel";
import { PlatformPage } from "@/components/admin/platform/platform-page";
import { PlatformWsFigures, PlatformWsFiguresLoading, PlatformWsNeeds } from "@/components/admin/platform/ws-sections";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { platformStepsFor } from "@/lib/adminPlatform/steps";

/**
 * Admin › Platform workspace (admin round 1, owner 2026-11-18: Platform "all in one", like Catalog and Monitoring):
 * the figures, then Needs a look, one line per thing that waits on an admin across the Platform pages, each opening
 * its page, filtered. Every row reads the loader its page already uses (lib/adminPlatform/reads.ts). Each part streams
 * and fails on its own; the rail and the title show at once.
 *
 * Open to any admin whose menu offers a Platform page (Legal is every admin's); a role sees only the figures and rows
 * of the pages it may open.
 */
export default async function PlatformWorkspacePage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!platformStepsFor(admin.role).some((step) => step.key === "workspace")) redirect("/admin");
  const viewer = { id: admin.id, role: admin.role };

  return (
    <PlatformPage
      step="workspace"
      title="Platform"
      info="How the platform runs: call screening, disclosures and calling rules, mail, maintenance, staff and legal. Each item opens its page, filtered."
      actions={canOpenAdminHref(admin.role, "/admin/audit-log") ? <Link href="/admin/audit-log" className={buttonVariants({ variant: "outline" })}>Open Audit Log</Link> : undefined}
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <Suspense fallback={<PlatformWsFiguresLoading role={admin.role} />}>
          <PlatformWsFigures viewer={viewer} />
        </Suspense>
        <Suspense fallback={<WsPanelLoading title="Needs a look" rows={5} />}>
          <PlatformWsNeeds viewer={viewer} />
        </Suspense>
      </div>
    </PlatformPage>
  );
}

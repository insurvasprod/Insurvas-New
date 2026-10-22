import { redirect } from "next/navigation";
import { after as afterResponse } from "next/server";
import Link from "next/link";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { guideHref, isManualStep, nextSetupStep, SETUP_MODULES } from "@/lib/dashboard/checklist";
import { saveSetupGuideState } from "@/lib/dashboard/setupProgress";
import { loadViewerSetup } from "@/lib/dashboard/setupViewer";
import { SetupCelebration } from "@/components/app/setup/setup-celebration";
import { SetupStepList } from "@/components/app/setup/setup-step-list";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";

/**
 * Get set up — the walkthrough's home (2026-10-21, owner request; built on Basic Idea step 8 and
 * LA-0.3). Outside Notion: the module grouping, the guide bar each step opens, and the member list.
 *
 * Only the modules the plan pays for appear: an inbound-and-outbound plan sees its agency, outbound,
 * inbound and pipeline steps and nothing else (Basic Idea §6 — absent, never greyed). Each row opens
 * the real screen with `?guide=`, where the guide bar says what to do and ticks itself once it is done.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ celebrate?: string | string[] }> }) {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");
  const [entitlement, switches] = await Promise.all([getEntitlement(context.tenantId), loadFeatureSwitches()]);
  const available = applyKillSwitches(entitlement.features, switches, context.tenantId);
  const viewer = await loadViewerSetup(context, available, entitlement.limits.max_seats);
  if (viewer.needsStamp) afterResponse(viewer.stamp);
  // The first visit writes this person's row, so their next sign-in lands on the dashboard (firstLoginLanding).
  if (!viewer.guide.exists) afterResponse(() => saveSetupGuideState(context.tenantId, context.userId, viewer.guide).catch(() => undefined));

  const { checklist } = viewer;
  // The finish moment: the first view that finds everything done (it is also the one that stamps it),
  // or the guide bar's "Finish" (?celebrate=1) arriving after another page already stamped it.
  const celebrateParam = (await searchParams).celebrate;
  const celebrate = checklist.total > 0 && checklist.complete && (viewer.needsStamp || celebrateParam === "1");
  const next = nextSetupStep(checklist);
  const left = checklist.total - checklist.completed - checklist.skipped;
  const title = viewer.audience === "owner" ? "Get set up" : "Get started";
  const description =
    viewer.audience === "owner"
      ? "Set up the parts of Insurvas your plan includes. Each step opens the screen where you do it."
      : "A few first steps on the screens you will use every day.";

  const modules = SETUP_MODULES.map((module) => ({
    ...module,
    steps: checklist.steps.filter((step) => step.module === module.key).map((step) => ({ ...step, manual: isManualStep(step.key) })),
  })).filter((module) => module.steps.length > 0);

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      {celebrate ? <SetupCelebration steps={checklist.total} done={checklist.completed} audience={viewer.audience} /> : null}
      <PageHeader
        title={title}
        description={description}
        actions={next ? <Link href={guideHref(next)} className={buttonVariants({ variant: "default" })}>Start: {next.label}</Link> : null}
      />
      {checklist.total > 0 ? (
        <StatStrip label="Setup progress">
          <StatTile label="Done" value={`${checklist.completed} of ${checklist.total}`} />
          <StatTile label="Left" value={left} />
          <StatTile label="Skipped" value={checklist.skipped} labelTitle="Skipped steps stay here. Bring one back whenever you are ready." />
        </StatStrip>
      ) : null}
      {modules.length === 0 ? (
        <TableCard>
          <EmptyState title="Nothing to set up" hint="Your plan has no setup steps for your role." action={<Link href="/app/dashboard" className={buttonVariants({ variant: "outline" })}>Go to the dashboard</Link>} />
        </TableCard>
      ) : (
        modules.map((module) => (
          <TableCard key={module.key} title={module.label}>
            <SetupStepList steps={module.steps} nextKey={next?.key ?? null} />
          </TableCard>
        ))
      )}
    </div>
  );
}

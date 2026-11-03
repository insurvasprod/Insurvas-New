import { redirect } from "next/navigation";
import { after as afterResponse } from "next/server";
import Link from "next/link";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { guideHref, isManualStep, nextSetupStep, SETUP_GROUPS } from "@/lib/dashboard/checklist";
import { saveSetupGuideState } from "@/lib/dashboard/setupProgress";
import { loadViewerSetup } from "@/lib/dashboard/setupViewer";
import { hasImportedStatement } from "@/lib/dashboard/summaries";
import { hasTenantPermission } from "@/lib/tenantAuth/permissions";
import { SetupCelebration } from "@/components/app/setup/setup-celebration";
import { SetupModules } from "@/components/app/setup/setup-modules";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { Meter } from "@/components/ui/stat";
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

  // Three groups (owner, 2026-10-28): Start working, Get paid right, and the folded Fine-tune later.
  const modules = SETUP_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    hint: group.hint,
    optional: group.key === "later",
    steps: checklist.steps.filter((step) => (step.group ?? "start") === group.key).map((step) => ({ ...step, manual: isManualStep(step.key) })),
  })).filter((module) => module.steps.length > 0);

  // The first-value row (redesign, 2026-10-24): "Find money the carriers owe you" leads the page, as
  // checkout leads with /app/welcome. Same gate as that page (owner or bookkeeper, carrier files on
  // the plan, not read-only), and gone once a statement stands, because from then the figure is on
  // Discrepancies and Home. The owner's checklist already knows (the statement step); anyone else
  // costs one head count.
  const canFindMoney =
    available.includes("statement_ingestion") && entitlement.access !== "read_only" && hasTenantPermission(context.role, "statements.view");
  const statementStep = checklist.steps.find((step) => step.key === "statement");
  // Only where money is the work (owner, 2026-10-28): a plan that dials, takes transfers or sells starts
  // with Start working, and its statement waits in Get paid right; a Ledger plan still leads with it.
  const moneyPlan = !checklist.steps.some((step) => (step.group ?? "start") === "start" && step.key !== "carriers" && step.key !== "team");
  const showFirstValue = canFindMoney && (viewer.audience !== "owner" || moneyPlan) && !(statementStep ? statementStep.complete : await hasImportedStatement(context.tenantId));

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      {celebrate ? <SetupCelebration steps={checklist.total} done={checklist.completed} audience={viewer.audience} /> : null}
      <PageHeader
        title={title}
        description={description}
        actions={next ? <Link href={guideHref(next)} className={buttonVariants({ variant: "default" })}>Start: {next.label}</Link> : null}
      />
      {showFirstValue ? (
        <TableCard>
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2 bg-[var(--primary-soft)] px-4 py-3 sm:items-center">
            <span aria-hidden="true" className="mt-0.5 inline-flex size-5 shrink-0 rounded-full border-[1.5px] border-primary sm:mt-0" />
            <span className="flex min-w-0 flex-1 basis-[calc(100%-2rem)] flex-wrap items-center gap-x-1.5 gap-y-1 sm:basis-0">
              <span className="min-w-0 break-words text-sm font-semibold text-foreground">Find money the carriers owe you</span>
              <span className="w-full text-xs tabular-nums text-muted-foreground sm:w-auto">About 3 min</span>
            </span>
            <span className="ml-8 flex flex-wrap items-center gap-2 sm:ml-0 sm:shrink-0">
              <Link href="/app/welcome" className={buttonVariants({ variant: "default" })}>Upload a statement</Link>
            </span>
          </div>
        </TableCard>
      ) : null}
      {/* One line, not three counters (owner, 2026-10-28): the list below already shows every step. */}
      {checklist.total > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Meter value={checklist.completed} max={checklist.total} tone="primary" label={`${checklist.completed} of ${checklist.total} setup steps done`} className="w-full max-w-md" />
          <span className="text-sm tabular-nums text-muted-foreground">
            {checklist.completed} of {checklist.total} done{left > 0 ? ` · ${left} to go` : ""}{checklist.skipped > 0 ? ` · ${checklist.skipped} skipped` : ""}
          </span>
        </div>
      ) : null}
      {modules.length === 0 ? (
        <TableCard>
          <EmptyState title="Nothing to set up" hint="Your plan has no setup steps for your role." action={<Link href="/app/dashboard" className={buttonVariants({ variant: "outline" })}>Go to the dashboard</Link>} />
        </TableCard>
      ) : (
        <SetupModules modules={modules} nextKey={next?.key ?? null} />
      )}
    </div>
  );
}

import { redirect } from "next/navigation";
import { after as afterResponse } from "next/server";
import Link from "next/link";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { nextSetupStep } from "@/lib/dashboard/checklist";
import { allDocPages } from "@/lib/docs/content";
import { loadSetupPause, saveSetupGuideState } from "@/lib/dashboard/setupProgress";
import { loadSetupCounts } from "@/lib/dashboard/setupCounts";
import { loadViewerSetup } from "@/lib/dashboard/setupViewer";
import { SetupCelebration } from "@/components/app/setup/setup-celebration";
import { SetupPath } from "@/components/app/setup/setup-path";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { Meter } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";

/**
 * Get set up, R4 G1·A (owner 2026-11-13: "redesign … how we can present this better to the client"). The same
 * shape as Docs and Settings: every step in the Settings-style menu on the left, grouped by phase; on the right
 * the chosen step (`?step=`) explained before you start it — why, the one gold Start, Watch how, its video and the
 * clicks the guide will show. Once Ready to sell is done, the right side is a summary worth showing.
 *
 * Only the steps the plan and role allow appear (lib/dashboard/checklist.ts). Each Start opens the real screen with
 * `?guide=`, where the guide shows every click and the step ticks itself once its data proves it.
 */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ celebrate?: string | string[]; step?: string | string[] }> }) {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");
  const [entitlement, switches] = await Promise.all([getEntitlement(context.tenantId), loadFeatureSwitches()]);
  const available = applyKillSwitches(entitlement.features, switches, context.tenantId);
  const [viewer, serverPaused] = await Promise.all([
    loadViewerSetup(context, available, entitlement.limits.max_seats),
    loadSetupPause(context.tenantId, context.userId),
  ]);
  if (viewer.needsStamp) afterResponse(viewer.stamp);
  // The first visit writes this person's row, so their next sign-in lands on the dashboard (firstLoginLanding).
  if (!viewer.guide.exists) afterResponse(() => saveSetupGuideState(context.tenantId, context.userId, viewer.guide).catch(() => undefined));

  const { checklist } = viewer;
  const params = await searchParams;
  // The finish moment: the first view that finds everything done (it is also the one that stamps it),
  // or the guide bar's "Finish" (?celebrate=1) arriving after another page already stamped it.
  const celebrate = checklist.total > 0 && checklist.complete && (viewer.needsStamp || params.celebrate === "1");
  const next = nextSetupStep(checklist);
  const owner = viewer.audience === "owner";
  const readyLabel = owner ? "Ready to sell" : "Ready to work";

  const pathStep = (step: (typeof checklist.steps)[number]) => ({
    key: step.key, label: step.label, path: step.path, why: step.why, instruction: step.instruction, target: step.target,
    minutes: step.minutes, complete: step.complete, skipped: step.skipped, optional: step.optional,
  });
  const required = checklist.steps.filter((step) => !step.optional).map(pathStep);
  const optional = checklist.steps.filter((step) => step.optional).map(pathStep);
  const requiredDone = required.filter((step) => step.complete).length;
  // Each step's Docs page: its video slot, "Watch how" and "Read it in Docs".
  const docs = Object.fromEntries(allDocPages().filter((page) => page.chapter === "setup").map((page) => [page.slug, page.video]));
  const docPages = allDocPages().filter((page) => page.chapter !== "setup").length;
  // The finished summary's figures (R4 G2): only for the owner, and only once Ready to sell is done.
  const counts = owner && required.length > 0 && requiredDone === required.length ? await loadSetupCounts(context.tenantId) : null;

  return (
    <div className="flex min-h-0 flex-grow flex-col gap-4">
      {celebrate ? <SetupCelebration steps={checklist.total} done={checklist.completed} audience={viewer.audience} /> : null}
      <PageHeader
        title={owner ? "Get set up" : "Get started"}
        description={owner ? "Set up the parts of Insurvas your plan includes. Choose a step to see what it does; Start opens the real page and shows you every click." : "A few first steps on the screens you will use every day. Each one shows you every click."}
        actions={
          <>
            {required.length > 0 ? (
              <span className="flex items-center gap-2.5">
                <span className="text-xs tabular-nums text-muted-foreground">{readyLabel} · {requiredDone} of {required.length}</span>
                <Meter value={requiredDone} max={required.length} tone="primary" label={`${requiredDone} of ${required.length} done`} className="w-40" />
              </span>
            ) : null}
            <Link href="/app/docs" className={buttonVariants({ variant: "outline" })}>Docs</Link>
          </>
        }
      />
      {checklist.steps.length === 0 ? (
        <TableCard>
          <EmptyState title="Nothing to set up" hint="Your plan has no setup steps for your role." action={<Link href="/app/dashboard" className={buttonVariants({ variant: "outline" })}>Go to the dashboard</Link>} />
        </TableCard>
      ) : (
        <SetupPath
          required={required}
          optional={optional}
          nextKey={next?.key ?? null}
          askedKey={typeof params.step === "string" ? params.step : null}
          readyLabel={readyLabel}
          serverPaused={serverPaused}
          docs={docs}
          docPages={docPages}
          teamSetup={owner && available.includes("agency_dashboard")}
          counts={counts}
        />
      )}
    </div>
  );
}

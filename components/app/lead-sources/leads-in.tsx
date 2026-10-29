import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { isAgencyTenant } from "@/lib/agency/audience";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { LEADS_IN_STEPS, type LeadsInStep } from "@/lib/leadSources/steps";
import { LeadsInRail } from "@/components/app/lead-sources/leads-in-rail";

/**
 * Leads in (owner pick B, 2026-10-28, canvas "M2 · Leads in (one page)"): List import, Lead sources,
 * Lead routing, Lead recycling and Duplicate check are one page — six steps in the order Module 2
 * §5–§6 works a list, down a rail on the left, the step on the right.
 *
 * Each step keeps its own address and its own route's gate (`/app/campaigns`, `/app/import`,
 * `/app/duplicates`, `/app/lead-sources`, `/app/assignments`, `/app/nurture`), so every old link,
 * bookmark and guide target still lands on the right screen; the route renders its screen inside this
 * frame. The rail offers only the steps this person may open, by the same rules those routes apply.
 */
export type { LeadsInStep };

/** Which steps this person may open — each one the gate its own route applies. */
async function openSteps(): Promise<{ open: Set<LeadsInStep>; routeHref: string }> {
  const [lists, outbound, dupes, routing] = await Promise.all([guardPage("lead_import"), guardPage("outbound_dialing"), guardPage("duplicate_detection"), guardPage("lead_assignment")]);
  const anyGuard = [lists, outbound, dupes, routing].find((guard) => guard.entitled);
  if (!anyGuard) return { open: new Set(), routeHref: "/app/assignments" };
  const [narrow, agency, solo] = await Promise.all([scopeFor(anyGuard.context).then((scope) => scope !== null), isAgencyTenant(anyGuard.context.tenantId), isSoloWorkspace(anyGuard.context.tenantId)]);
  const open = new Set<LeadsInStep>();
  if (outbound.entitled && (outbound.role === "owner" || outbound.role === "producer") && !narrow) open.add("source");
  if (lists.entitled && (lists.role === "owner" || lists.role === "producer" || lists.role === "assistant") && !narrow) { open.add("import"); open.add("review"); }
  if (dupes.entitled && actAsPage(dupes, ["owner", "producer", "assistant"]) && !narrow) open.add("clean");
  if (lists.entitled && actAsPage(lists, ["owner", "producer", "assistant"]) && !narrow) open.add("lists");
  const dialRoute = outbound.entitled && actAsPage(outbound, ["owner", "producer", "assistant", "setter"]) && (!agency || outbound.role === "owner");
  const poolRoute = routing.entitled && routing.role === "owner";
  // Solo mode (owner 2026-10-29): nobody to route to, so the rail runs Lists → Recycle.
  if ((dialRoute || poolRoute) && !solo) open.add("route");
  if (outbound.entitled && actAsPage(outbound, ["owner", "producer"]) && !narrow) open.add("recycle");
  // An agency owner without dialing has the pool only, on Team › Lead routing.
  return { open, routeHref: dialRoute ? "/app/assignments" : "/app/lead-routing" };
}

/**
 * The frame. One full-height grid: the rail on the left, standing the whole height; on the right a top
 * row level with the rail's top — the step's own tabs or picker on the left (`LeadsInSlot slot="lead"`),
 * Back and "Continue to …" in the corner (owner 2026-10-28: always that spot) — then the step, which
 * scrolls inside itself. `ownContinue`: the step's next move is its own action (Import's "Continue to
 * review", Review's "Import N leads"), which it puts in the corner through `LeadsInSlot slot="continue"`.
 */
export async function LeadsInPage({ step, actions, ownContinue = false, children }: { step: LeadsInStep; actions?: ReactNode; ownContinue?: boolean; children: ReactNode }) {
  const { open, routeHref } = await openSteps();
  // The step on screen is always offered: its route already let this person in.
  open.add(step);
  const steps = LEADS_IN_STEPS.filter((item) => open.has(item.key)).map((item) => (item.key === "route" ? { ...item, href: routeHref } : item));
  const here = steps.findIndex((item) => item.key === step);
  // Review has no address of its own until a file is staged: Back from Clean goes to Import then.
  const prev = steps[here - 1]?.key === "review" ? steps[here - 2] : steps[here - 1];
  const next = steps[here + 1];

  return (
    // Two rows (owner 2026-10-29): the top row sits over the step's column only, so the rail starts on
    // the same line as the step's first card and ends with it — the rail is exactly the content's height.
    <div className="grid w-full min-w-0 gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-56px)] lg:grid-cols-[264px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col lg:col-start-2 lg:row-start-1">
        <PageHeader title="Lead sources" />
        <div className="flex min-h-[2.25rem] flex-wrap items-center gap-3">
          <div id="leads-in-lead" className="flex min-w-0 flex-1 flex-wrap items-center gap-3" />
          <div className="ml-auto flex items-center gap-2">
            {actions}
            {prev && <Button asChild variant="outline"><Link href={prev.href}><ArrowLeft aria-hidden="true" />Back</Link></Button>}
            {ownContinue
              ? <span id="leads-in-continue" className="contents" />
              : next && <Button asChild><Link href={next.href}>Continue to {next.label}<ArrowRight aria-hidden="true" /></Link></Button>}
          </div>
        </div>
      </div>
      <div className="lg:col-start-1 lg:row-start-2 lg:min-h-0">
        <LeadsInRail steps={steps} step={step} />
      </div>
      {/* The step scrolls inside its own column; the rail stays put (owner 2026-10-28: no outer scroll). */}
      <div key={step} className="flex min-w-0 flex-col gap-6 motion-safe:animate-[m-rise_.38s_cubic-bezier(.2,.8,.2,1)_both] lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        {children}
      </div>
    </div>
  );
}

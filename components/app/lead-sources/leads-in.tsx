import type { ReactNode } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { isAgencyTenant } from "@/lib/agency/audience";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";
import { PageHeader } from "@/components/ui/page-header";
import { LEADS_IN_STEPS, RAIL_COOKIE, leadsInStepLabel, type LeadsInStep } from "@/lib/leadSources/steps";
import { cookies } from "next/headers";
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
  const [{ open, routeHref }, jar] = await Promise.all([openSteps(), cookies()]);
  const collapsed = jar.get(RAIL_COOKIE)?.value === "collapsed";
  // The step on screen is always offered: its route already let this person in.
  open.add(step);
  const steps = LEADS_IN_STEPS.filter((item) => open.has(item.key)).map((item) => (item.key === "route" ? { ...item, href: routeHref } : item));

  return (
    // The page's title and trail across the top (owner 2026-10-30), then two rows (owner 2026-10-29):
    // the step's own row sits over the step's column only, so the rail starts on the same line as the
    // step's first card and ends with it — the rail is exactly the content's height.
    // The title sits 24px over the content, as on every other page (owner 2026-10-30: "not that much space
    // from the title"): the step's own row takes no room when it has nothing in it, and the rows carry their
    // own space below instead of the grid's row gap, so an empty row adds no gap either.
    // The step's own row (its tabs, its actions) is the first line of the step's column, level with the
    // rail's top (owner 2026-10-30: "same thing as the Source page, for all of the pages"), not a row above it.
    // One column under lg: minmax(0,1fr), or the rail's row of chips would stretch it past the phone's width.
    <div data-step-frame className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-56px)] lg:grid-cols-[auto_minmax(0,1fr)] lg:grid-rows-[min-content_minmax(0,1fr)] lg:gap-y-0">
      {/* The step's tabs and actions are on the title's line (owner 2026-11-02), so its first card starts
          level with the rail's top. No Back / "Continue to …" (manager 2026-10-29): the corner holds the
          page's own actions only. */}
      <PageHeader
        title={leadsInStepLabel(step)}
        lead={<div id="leads-in-lead" className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden" />}
        actions={<>{actions}{ownContinue && <span id="leads-in-continue" className="contents" />}</>}
        className="lg:col-span-2 lg:pb-6"
      />
      <div className="lg:col-start-1 lg:row-start-2 lg:min-h-0">
        <LeadsInRail steps={steps} step={step} initialCollapsed={collapsed} />
      </div>
      <div className="flex min-w-0 flex-col lg:col-start-2 lg:row-start-2 lg:min-h-0">
        {/* The step scrolls inside its own column under its row; the rail stays put (owner 2026-10-28: no outer scroll). */}
        {/* [&>*]:shrink-0: a step's own wrapper never gives up height to the scroll box (a StatStrip squeezed to a line). */}
        {/* data-page-content: the step's column is what moves between steps (§ Motion: down the menu slides from the
            right, up from the left), and what dims while the next step loads; the title and the rail stay. */}
        <div key={step} data-page-content className="m-content-in flex min-w-0 flex-col gap-4 [&>*]:shrink-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
          {children}
        </div>
      </div>
    </div>
  );
}

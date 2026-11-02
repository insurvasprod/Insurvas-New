import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { mayGenerateReports } from "@/lib/compliance/evidenceReport";
import { PageHeader } from "@/components/ui/page-header";
import { COMPLIANCE_RAIL_COOKIE, COMPLIANCE_STEPS, complianceStepLabel, type ComplianceStep } from "@/lib/compliance/steps";
import { ComplianceRail } from "@/components/app/compliance/compliance-rail";

/**
 * Compliance in one page (2026-10-30, canvas "M6 · Compliance (one page)", the Leads in treatment): the
 * Overview, TCPA / DNC, Consent locker, Complaints, Deletion requests and Evidence report are six steps
 * down a rail on the left, the step on the right.
 *
 * Each step keeps its own address and its own route's gate (`/app/compliance`, `/app/tcpa`, `/app/consent`,
 * `/app/complaints`, `/app/deletion-requests`, `/app/evidence-report`), so every old link, bookmark, alert
 * and email still lands on the right screen; the route renders its screen inside this frame. The rail
 * offers only the steps this person may open, by the same rules those routes apply.
 */
async function openSteps(): Promise<{ open: Set<ComplianceStep>; owner: boolean }> {
  const [tcpa, consent, litigation] = await Promise.all([guardPage("tcpa_checker"), guardPage("consent_locker"), guardPage("litigation_packet")]);
  const anyGuard = [tcpa, consent, litigation].find((guard) => guard.entitled);
  const open = new Set<ComplianceStep>();
  if (!anyGuard) return { open, owner: false };
  // AG-0.5: inside an agency every step is the owner's and admins' business; a narrow session opens none.
  if ((await scopeFor(anyGuard.context)) !== null) return { open, owner: false };
  if (tcpa.entitled && actAsPage(tcpa, ["owner", "producer"])) { open.add("overview"); open.add("complaints"); open.add("deletions"); }
  if (tcpa.entitled && actAsPage(tcpa, ["owner", "producer", "assistant", "setter"])) open.add("dnc");
  if (consent.entitled && actAsPage(consent, ["owner", "producer", "assistant"])) open.add("consent");
  if (litigation.entitled && actAsPage(litigation, ["owner", "producer"]) && (await mayGenerateReports(litigation.context.tenantId, litigation.role))) open.add("evidence");
  return { open, owner: tcpa.entitled && tcpa.role === "owner" };
}

/**
 * The frame. The page's title and trail across the top, 24px over the content; then the rail standing the
 * full height on the left and, on the right, the step's own row (its tabs in `ComplianceSlot slot="lead"`,
 * its actions in `slot="corner"`) over the step, which scrolls inside itself — never the page.
 */
export async function ComplianceFlowPage({ step, actions, children }: { step: ComplianceStep; actions?: ReactNode; children: ReactNode }) {
  const [{ open, owner }, jar] = await Promise.all([openSteps(), cookies()]);
  const collapsed = jar.get(COMPLIANCE_RAIL_COOKIE)?.value === "collapsed";
  // The step on screen is always offered: its route already let this person in.
  open.add(step);
  const steps = COMPLIANCE_STEPS.filter((item) => open.has(item.key));

  return (
    // One column on a phone (minmax(0,1fr), so the rail's chip row scrolls instead of widening the page).
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-56px)] lg:grid-cols-[auto_minmax(0,1fr)] lg:grid-rows-[min-content_minmax(0,1fr)] lg:gap-y-0">
      <PageHeader title={complianceStepLabel(step)} className="lg:col-span-2 lg:pb-6" />
      <div className="lg:col-start-1 lg:row-start-2 lg:min-h-0">
        <ComplianceRail steps={steps} step={step} initialCollapsed={collapsed} settingsHref={owner ? "/app/compliance/settings" : null} />
      </div>
      <div className="flex min-w-0 flex-col lg:col-start-2 lg:row-start-2 lg:min-h-0">
        <div className={`flex flex-none flex-wrap items-center gap-3 pb-4 ${actions ? "" : "[&:not(:has(#compliance-lead>*)):not(:has(#compliance-corner>*))]:hidden"}`}>
          <div id="compliance-lead" className="flex min-h-[2.25rem] min-w-0 flex-1 flex-wrap items-center gap-2" />
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <span id="compliance-corner" className="contents" />
          </div>
        </div>
        {/* Its blocks keep their height (a strip is never squeezed); the one table card grows into what is left. */}
        <div key={step} className="flex min-w-0 flex-col gap-6 [&>*]:shrink-0 motion-safe:animate-[m-rise_.38s_cubic-bezier(.2,.8,.2,1)_both] lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
          {children}
        </div>
      </div>
    </div>
  );
}

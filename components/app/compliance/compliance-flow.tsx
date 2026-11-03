import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { mayGenerateReports } from "@/lib/compliance/evidenceReport";
import { StepFrame } from "@/components/app/step-frame/step-frame";
import { InfoTip } from "@/components/ui/info-tip";
import { COMPLIANCE_RAIL_COOKIE, COMPLIANCE_STEPS, COMPLIANCE_WAITING, complianceStepLabel, type ComplianceStep } from "@/lib/compliance/steps";

/**
 * Compliance in one page (2026-10-30, canvas "M6 · Compliance (one page)", the Leads in treatment): the
 * Overview, TCPA / DNC, Consent locker, Complaints, Deletion requests, Evidence report and Licences &
 * appointments are steps down a rail on the left, the step on the right.
 *
 * Each step keeps its own address and its own route's gate (`/app/compliance`, `/app/tcpa`, `/app/consent`,
 * `/app/complaints`, `/app/deletion-requests`, `/app/evidence-report`, `/app/appointments`), so every old
 * link, bookmark, alert and email still lands on the right screen; the route renders its screen inside this
 * frame. The rail offers only the steps this person may open, by the same rules those routes apply.
 */
async function openSteps(): Promise<{ open: Set<ComplianceStep>; owner: boolean }> {
  const [tcpa, consent, litigation, vault] = await Promise.all([guardPage("tcpa_checker"), guardPage("consent_locker"), guardPage("litigation_packet"), guardPage("appointment_vault")]);
  const anyGuard = [tcpa, consent, litigation].find((guard) => guard.entitled);
  const open = new Set<ComplianceStep>();
  // Licences & appointments keeps its own route's rule (owner and producer), agency or not.
  if (vault.entitled && actAsPage(vault, ["owner", "producer"])) open.add("appointments");
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
 * The frame: the shared StepFrame (foundation pass 2026-11-03; it had its own copy of the rail) with this
 * page's steps, badges and, for the owner, Compliance settings at the rail's foot.
 *
 * Everything above the step is on the title line, as Book of business and Accounting: `lead` holds the step's
 * tabs, `actions` at most two buttons and a More menu, `info` the step's (i). A record under a step (a
 * complaint, a deletion request, a certificate) passes its `title`, its status `chip` and one muted line of
 * `facts`. A client screen can also put its tabs and buttons there through `ComplianceSlot` (`lead`,
 * `corner`), which portals into the two empty slots drawn here.
 */
export async function ComplianceFlowPage({ step, title, info, chip, facts, lead, actions, children }: {
  step: ComplianceStep;
  title?: string;
  info?: ReactNode;
  chip?: ReactNode;
  facts?: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [{ open, owner }, jar] = await Promise.all([openSteps(), cookies()]);
  // The step on screen is always offered: its route already let this person in.
  open.add(step);
  const steps = COMPLIANCE_STEPS.filter((item) => open.has(item.key));
  const heading = title ?? complianceStepLabel(step);

  return (
    <StepFrame
      title={heading}
      titleInfo={info || chip ? <>{info ? <InfoTip label={`About ${heading}`} side="right">{info}</InfoTip> : null}{chip}</> : undefined}
      // The facts never widen the title's column: they wrap in it, at least 360px wide (Accounting, 2026-11-03).
      meta={facts ? <p className="mt-1 text-sm text-muted-foreground lg:min-w-[360px] lg:[contain:inline-size]">{facts}</p> : undefined}
      lead={<>{lead}<div id="compliance-lead" className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden" /></>}
      actions={<>{actions}<span id="compliance-corner" className="contents" /></>}
      rail={{
        label: "Compliance",
        cookie: COMPLIANCE_RAIL_COOKIE,
        countsUrl: steps.some((item) => item.key === "complaints" || item.key === "deletions") ? "/api/app/compliance/steps" : undefined,
        waiting: COMPLIANCE_WAITING,
        steps,
        step,
        collapsed: jar.get(COMPLIANCE_RAIL_COOKIE)?.value === "collapsed",
        foot: owner ? { label: "Compliance settings", href: "/app/compliance/settings" } : null,
      }}
    >
      {children}
    </StepFrame>
  );
}

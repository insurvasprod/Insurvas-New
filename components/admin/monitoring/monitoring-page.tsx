import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { StepFrame } from "@/components/app/step-frame/step-frame";
import type { RailStep } from "@/components/app/step-frame/step-rail";
import type { Crumb } from "@/components/ui/breadcrumbs";
import { InfoTip } from "@/components/ui/info-tip";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { MONITORING_RAIL_COOKIE, MONITORING_STEPS, MONITORING_WAITING, monitoringStepLabel, monitoringStepsFor, type MonitoringStep } from "@/lib/adminMonitoring/steps";

/**
 * Admin › Monitoring, one area (admin round 1, owner 2026-11-17; docs/design/admin-r1/monitoring.html). The shared
 * StepFrame: title and trail across the top, the Monitoring rail on the left (Workspace; Sign-ins, Records, Health),
 * the page on the right scrolling inside itself. Twins: billing/billing-page.tsx, catalog/catalog-page.tsx.
 *
 * Every page keeps its own route and gate; this only draws. The rail offers the steps the role's admin menu offers,
 * and the step on screen is always shown since its route already let this admin in.
 */
export async function MonitoringPage({ step, title, info, breadcrumbs, tabs, actions, children }: {
  step: MonitoringStep;
  /** A record under a step names itself; else the step's label. */
  title?: string;
  /** The (i) beside the title: what the page is for, in a sentence. */
  info?: ReactNode;
  /** A record's own trail (Monitoring › Audit log › …); else the page trail. */
  breadcrumbs?: Crumb[];
  /** The step's sub-page bar or lenses (ViewTabs), on the title's line. */
  tabs?: ReactNode;
  /** At most two buttons; one may be the page's gold feature button. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [admin, jar] = await Promise.all([getCurrentAdmin(), cookies()]);
  const role = admin?.role ?? "support_agent";
  const steps: RailStep[] = monitoringStepsFor(role).map(({ key, label, href, icon, group }) => ({ key, label, href, icon, group }));
  const own = MONITORING_STEPS.find((item) => item.key === step);
  if (own && !steps.some((item) => item.key === step)) steps.push({ key: own.key, label: own.label, href: own.href, icon: own.icon, group: own.group });
  const heading = title ?? monitoringStepLabel(step);

  return (
    <StepFrame
      title={heading}
      breadcrumbs={breadcrumbs}
      titleInfo={info ? <InfoTip label={`About ${heading}`} side="right">{info}</InfoTip> : undefined}
      tabs={tabs}
      actions={actions}
      rail={{ label: "Monitoring", cookie: MONITORING_RAIL_COOKIE, countsUrl: "/api/admin/monitoring/steps", waiting: MONITORING_WAITING, steps, step, foot: null, collapsed: jar.get(MONITORING_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

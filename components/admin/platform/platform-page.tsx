import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { StepFrame } from "@/components/app/step-frame/step-frame";
import type { RailStep } from "@/components/app/step-frame/step-rail";
import type { Crumb } from "@/components/ui/breadcrumbs";
import { InfoTip } from "@/components/ui/info-tip";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { PLATFORM_RAIL_COOKIE, PLATFORM_STEPS, PLATFORM_WAITING, platformStepLabel, platformStepsFor, type PlatformStep } from "@/lib/adminPlatform/steps";

/**
 * Admin › Platform, one area (admin round 1, owner 2026-11-18). The shared StepFrame: title and trail across the top,
 * the Platform rail on the left (Workspace; Rules, Communication, System, People & records), the page on the right
 * scrolling inside itself. Twins: monitoring/monitoring-page.tsx, catalog/catalog-page.tsx.
 *
 * Every page keeps its own route and gate; this only draws. The rail offers the steps the role's admin menu offers,
 * and the step on screen is always shown since its route already let this admin in.
 */
export async function PlatformPage({ step, title, info, breadcrumbs, tabs, actions, children }: {
  step: PlatformStep;
  /** A record under a step names itself; else the step's label. */
  title?: string;
  /** The (i) beside the title: what the page is for, in a sentence. */
  info?: ReactNode;
  /** A record's own trail; else the page trail. */
  breadcrumbs?: Crumb[];
  /** The step's sub-page bar or lenses (ViewTabs), on the title's line. */
  tabs?: ReactNode;
  /** At most two buttons; one may be the page's gold feature button. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [admin, jar] = await Promise.all([getCurrentAdmin(), cookies()]);
  const role = admin?.role ?? "support_agent";
  const steps: RailStep[] = platformStepsFor(role).map(({ key, label, href, icon, group }) => ({ key, label, href, icon, group }));
  const own = PLATFORM_STEPS.find((item) => item.key === step);
  if (own && !steps.some((item) => item.key === step)) steps.push({ key: own.key, label: own.label, href: own.href, icon: own.icon, group: own.group });
  const heading = title ?? platformStepLabel(step);

  return (
    <StepFrame
      title={heading}
      breadcrumbs={breadcrumbs}
      titleInfo={info ? <InfoTip label={`About ${heading}`} side="right">{info}</InfoTip> : undefined}
      tabs={tabs}
      actions={actions}
      rail={{ label: "Platform", cookie: PLATFORM_RAIL_COOKIE, countsUrl: "/api/admin/platform/steps", waiting: PLATFORM_WAITING, steps, step, foot: null, collapsed: jar.get(PLATFORM_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

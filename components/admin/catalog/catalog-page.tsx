import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { StepFrame } from "@/components/app/step-frame/step-frame";
import type { RailStep } from "@/components/app/step-frame/step-rail";
import type { Crumb } from "@/components/ui/breadcrumbs";
import { InfoTip } from "@/components/ui/info-tip";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { CATALOG_RAIL_COOKIE, CATALOG_STEPS, CATALOG_WAITING, catalogStepLabel, catalogStepsFor, type CatalogStep } from "@/lib/adminCatalog/steps";

/**
 * Admin › Catalog, one area (admin round 1, owner 2026-11-17; docs/design/admin-r1/catalog.html). The shared StepFrame:
 * title and trail across the top, the Catalog rail on the left (Workspace first; What we sell, Insurance, Carriers),
 * the page on the right scrolling inside itself. Billing's twin is components/admin/billing/billing-page.tsx.
 *
 * Every page keeps its own route and gate; this only draws. The rail offers the steps the role's admin menu offers,
 * and the step on screen is always shown since its route already let this admin in.
 */
export async function CatalogPage({ step, title, info, breadcrumbs, tabs, actions, children }: {
  step: CatalogStep;
  /** A record under a step (a carrier, a plan's editor, a layout) names itself; else the step's label. */
  title?: string;
  /** The (i) beside the title: what the page is for, in a sentence. */
  info?: ReactNode;
  /** A record's own trail (Catalog › Carriers › Americo); else the page trail. */
  breadcrumbs?: Crumb[];
  /** The step's sub-page bar or lenses (ViewTabs), on the title's line. */
  tabs?: ReactNode;
  /** At most two buttons; one may be the page's gold feature button. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [admin, jar] = await Promise.all([getCurrentAdmin(), cookies()]);
  const role = admin?.role ?? "support_agent";
  const steps: RailStep[] = catalogStepsFor(role).map(({ key, label, href, icon, group }) => ({ key, label, href, icon, group }));
  const own = CATALOG_STEPS.find((item) => item.key === step);
  if (own && !steps.some((item) => item.key === step)) steps.push({ key: own.key, label: own.label, href: own.href, icon: own.icon, group: own.group });
  const heading = title ?? catalogStepLabel(step);

  return (
    <StepFrame
      title={heading}
      breadcrumbs={breadcrumbs}
      titleInfo={info ? <InfoTip label={`About ${heading}`} side="right">{info}</InfoTip> : undefined}
      tabs={tabs}
      actions={actions}
      rail={{ label: "Catalog", cookie: CATALOG_RAIL_COOKIE, countsUrl: "/api/admin/catalog/steps", waiting: CATALOG_WAITING, steps, step, foot: null, collapsed: jar.get(CATALOG_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

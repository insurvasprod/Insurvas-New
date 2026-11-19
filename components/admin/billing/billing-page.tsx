import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { StepFrame } from "@/components/app/step-frame/step-frame";
import type { RailStep } from "@/components/app/step-frame/step-rail";
import { InfoTip } from "@/components/ui/info-tip";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { BILLING_RAIL_COOKIE, BILLING_STEPS, BILLING_WAITING, billingFootFor, billingStepLabel, billingStepsFor, type BillingStep } from "@/lib/adminBilling/steps";

/**
 * Admin › Billing, one area (admin round 1, owner 2026-11-17: "similar to accounting, compliance, reports — the
 * section on the left side that you select pages"; docs/design/admin-r1/billing-r2.html). The shared StepFrame: title
 * and trail across the top, the Billing rail on the left (Workspace first, the pages grouped, Payment provider at the
 * foot), the page on the right scrolling inside itself.
 *
 * Every page keeps its own route and its own gate; this only draws. The rail offers the steps the role's admin menu
 * offers (lib/adminBilling/steps.ts), and the step on screen is always shown since its route already let this admin in.
 */
export async function BillingPage({ step, title, info, tabs, actions, children }: {
  step: BillingStep;
  /** A record under a step (an invoice) names itself; else the step's label. */
  title?: string;
  /** The (i) beside the title: what the page is for, in a sentence. */
  info?: ReactNode;
  /** The step's sub-page bar or lenses (ViewTabs), on the title's line. */
  tabs?: ReactNode;
  /** At most two buttons; one may be the page's gold feature button. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [admin, jar] = await Promise.all([getCurrentAdmin(), cookies()]);
  const role = admin?.role ?? "support_agent";
  const steps: RailStep[] = billingStepsFor(role).map(({ key, label, href, icon, group }) => ({ key, label, href, icon, group }));
  const own = BILLING_STEPS.find((item) => item.key === step);
  if (own && step !== "provider" && !steps.some((item) => item.key === step)) steps.push({ key: own.key, label: own.label, href: own.href, icon: own.icon, group: own.group });
  const heading = title ?? billingStepLabel(step);

  return (
    <StepFrame
      title={heading}
      titleInfo={info ? <InfoTip label={`About ${heading}`} side="right">{info}</InfoTip> : undefined}
      tabs={tabs}
      actions={actions}
      rail={{ label: "Billing", cookie: BILLING_RAIL_COOKIE, countsUrl: "/api/admin/billing/steps", waiting: BILLING_WAITING, steps, step, foot: billingFootFor(role), collapsed: jar.get(BILLING_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

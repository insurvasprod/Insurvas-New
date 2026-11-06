import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { StepFrame } from "@/components/app/step-frame/step-frame";
import type { RailStep } from "@/components/app/step-frame/step-rail";
import type { Crumb } from "@/components/ui/breadcrumbs";
import { InfoTip } from "@/components/ui/info-tip";
import { RETENTION_RAIL_COOKIE, RETENTION_STEPS, retentionStepLabel, stepItem, type RetentionStep } from "@/lib/retention/steps";

/**
 * Retention, one page (owner 2026-11-02, as Commissions and Reports): Save queue, Servicing and Reinstatement
 * are three steps down a rail on the left, the step on the right.
 *
 * Each step keeps its own address and its own route's gate (`/app/save-queue`, `/app/servicing`,
 * `/app/reinstatement`), so every old link still lands
 * on the right screen. The rail offers only the steps this person may open, by the same rules those routes apply.
 */
async function openSteps(): Promise<RailStep[]> {
  const [radar, servicing, winback] = await Promise.all([guardPage("chargeback_radar"), guardPage("payment_repair"), guardPage("winback")]);
  const open = new Set<RetentionStep>();
  const worker = ["owner", "producer", "retention"] as const;
  if (radar.entitled && actAsPage(radar, worker)) open.add("cases");
  if (servicing.entitled && actAsPage(servicing, worker)) open.add("servicing");
  // Win-back calls are not a retention rep's (LA-5.8); their lapses are on Cases.
  if (winback.entitled && actAsPage(winback, ["owner", "producer"])) open.add("reinstatement");
  return RETENTION_STEPS.filter((item) => open.has(item.key));
}

/**
 * The frame: the shared StepFrame with this page's steps and rail. `lead`: the step's own tabs.
 *
 * A record under a step (a save card, a servicing request, a reinstatement case; the pick of 2026-11-05,
 * docs/retention/CRITIQUE.md) passes its `title`, its status `chip`, one muted line of `facts` and its trail,
 * as Accounting's records do; `actions` holds at most two buttons and a More menu.
 */
export async function RetentionPage({ step, title, info, chip, facts, breadcrumbs, lead, actions, children }: {
  step: RetentionStep;
  title?: string;
  info?: ReactNode;
  chip?: ReactNode;
  facts?: ReactNode;
  breadcrumbs?: Crumb[];
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [steps, jar] = await Promise.all([openSteps(), cookies()]);
  // The step on screen is always offered: its route already let this person in.
  // A retired step (the predictive Save queue) still answers at its address, at the rail's end.
  if (!steps.some((item) => item.key === step)) {
    const own = stepItem(step);
    const index = RETENTION_STEPS.indexOf(own);
    const at = index < 0 ? steps.length : steps.filter((item) => RETENTION_STEPS.findIndex((s) => s.key === item.key) < index).length;
    steps.splice(at, 0, own);
  }
  const heading = title ?? retentionStepLabel(step);
  return (
    <StepFrame
      title={heading}
      titleInfo={info || chip ? <>{info ? <InfoTip label={`About ${heading}`} side="right">{info}</InfoTip> : null}{chip}</> : undefined}
      meta={facts ? <p className="mt-1 text-sm text-muted-foreground lg:min-w-[360px] lg:[contain:inline-size]">{facts}</p> : undefined}
      breadcrumbs={breadcrumbs}
      lead={lead}
      actions={actions}
      rail={{ label: "Retention", cookie: RETENTION_RAIL_COOKIE, steps, step, collapsed: jar.get(RETENTION_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

/** The trail of a record under a Retention step: Retention › the step › the record. */
export function retentionTrail(step: RetentionStep, label: string, middle?: Crumb): Crumb[] {
  const own = stepItem(step);
  return [{ label: "Retention" }, { label: own.label, href: own.href }, ...(middle ? [middle] : []), { label }];
}

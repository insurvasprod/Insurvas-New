import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { StepFrame } from "@/components/app/step-frame/step-frame";
import type { RailStep } from "@/components/app/step-frame/step-rail";
import { COMMISSIONS_RAIL_COOKIE, COMMISSIONS_STEPS, COMMISSIONS_WAITING, MY_PAY, commissionsStepLabel, type CommissionsStep } from "@/lib/commissions/steps";

/**
 * Commissions, one page (owner 2026-11-02, the Data in and Accounting treatment): Pay issues and Producer pay
 * are steps down a rail on the left, the step on the right (the Commission ledger went to Book of business and
 * Hierarchy & overrides to Reports, owner 2026-11-05). My pay is the Producer pay step for a producer.
 *
 * Each step keeps its own address and its own route's gate (`/app/discrepancies`,
 * `/app/producer-reconciliation`, `/app/my-pay`),
 * so every old link still lands on the right screen. The rail offers only the steps this person may open,
 * by the same rules those routes apply.
 */
async function openSteps(): Promise<RailStep[]> {
  const [discrepancies, payouts] = await Promise.all([guardPage("discrepancy_report"), guardPage("producer_payouts")]);
  const open = new Set<CommissionsStep>();
  if (discrepancies.entitled && actAsPagePermission(discrepancies, "statements.view")) open.add("discrepancies");
  const payKeeper = payouts.entitled && actAsPage(payouts, ["owner", "bookkeeper"]);
  const payProducer = payouts.entitled && actAsPage(payouts, ["producer"]);
  if (payKeeper) open.add("reconciliation");
  if (payProducer) open.add("reconciliation");
  return COMMISSIONS_STEPS.filter((item) => open.has(item.key)).map((item) => (item.key === "reconciliation" && !payKeeper ? { ...item, ...MY_PAY } : item));
}

/**
 * The frame: the shared StepFrame with this page's steps, rail and badges. `pathname` names the address on
 * screen, so My pay keeps its own title.
 */
export async function CommissionsPage({ step, pathname, titleInfo, lead, actions, children }: { step: CommissionsStep; pathname?: string; titleInfo?: ReactNode; lead?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const [steps, jar] = await Promise.all([openSteps(), cookies()]);
  // The step on screen is always offered: its route already let this person in.
  if (!steps.some((item) => item.key === step)) {
    const own = COMMISSIONS_STEPS.find((item) => item.key === step)!;
    const at = steps.filter((item) => COMMISSIONS_STEPS.findIndex((s) => s.key === item.key) < COMMISSIONS_STEPS.indexOf(own)).length;
    steps.splice(at, 0, step === "reconciliation" && pathname === MY_PAY.href ? { ...own, ...MY_PAY } : own);
  }
  return (
    <StepFrame
      title={commissionsStepLabel(step, pathname)}
      titleInfo={titleInfo}
      lead={lead}
      actions={actions}
      rail={{ label: "Commissions", cookie: COMMISSIONS_RAIL_COOKIE, countsUrl: "/api/app/commissions/steps", waiting: COMMISSIONS_WAITING, steps, step, collapsed: jar.get(COMMISSIONS_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

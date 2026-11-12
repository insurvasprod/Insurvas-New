import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { StepFrame } from "@/components/app/step-frame/step-frame";
import type { RailStep } from "@/components/app/step-frame/step-rail";
import type { Crumb } from "@/components/ui/breadcrumbs";
import { InfoTip } from "@/components/ui/info-tip";
import { COMMISSIONS_RAIL_COOKIE, COMMISSIONS_STEPS, COMMISSIONS_WAITING, MY_PAY, commissionsStepLabel, type CommissionsStep } from "@/lib/commissions/steps";

/**
 * Commissions, one rail in the order money moves (round 7, owner 2026-11-10, mockups-r7/commissions.html 0·A):
 * Statements · Pay issues · Who gets the credit (money in), Producer pay · Team payouts · Commission splits ·
 * Partner payouts (money out). My pay is the Producer pay step for a producer.
 *
 * Each step keeps its own address and its own route's gate, so every old link still lands on the right screen.
 * The rail offers only the steps this person may open, by the same rules those routes apply.
 */
async function openSteps(): Promise<RailStep[]> {
  const [statements, discrepancies, payouts, partners] = await Promise.all([guardPage("statement_ingestion"), guardPage("discrepancy_report"), guardPage("producer_payouts"), guardPage("payout_runs")]);
  const open = new Set<CommissionsStep>();
  if (statements.entitled && actAsPagePermission(statements, "statements.view")) open.add("statements");
  if (discrepancies.entitled && actAsPagePermission(discrepancies, "statements.view")) open.add("discrepancies");
  const payKeeper = payouts.entitled && actAsPage(payouts, ["owner", "bookkeeper"]);
  const payProducer = payouts.entitled && actAsPage(payouts, ["producer"]);
  if (payKeeper) { open.add("attribution"); open.add("reconciliation"); open.add("teamPayouts"); open.add("splits"); }
  if (payProducer) open.add("reconciliation");
  if (partners.entitled && actAsPage(partners, ["owner", "bookkeeper"])) open.add("partnerPayouts");
  return COMMISSIONS_STEPS.filter((item) => open.has(item.key)).map((item) => (item.key === "reconciliation" && !payKeeper ? { ...item, ...MY_PAY, group: undefined } : item));
}

/**
 * The frame: the shared StepFrame with this page's steps, rail and badges. `pathname` names the address on screen,
 * so My pay keeps its own title. A record under a step (a statement, a pay issue, a letter, a credit item, a
 * producer statement, a partner invoice) passes its own `title` and `breadcrumbs`; nothing is drawn under a title
 * (owner 2026-11-10), so a record's facts go in a strip in the page, not a line here.
 */
export async function CommissionsPage({ step, pathname, title, info, titleInfo, breadcrumbs, tabs, actions, children }: {
  step: CommissionsStep;
  pathname?: string;
  title?: string;
  /** The (i) beside the title: one or two sentences. */
  info?: ReactNode;
  titleInfo?: ReactNode;
  breadcrumbs?: Crumb[];
  tabs?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [steps, jar] = await Promise.all([openSteps(), cookies()]);
  // The step on screen is always offered: its route already let this person in.
  if (!steps.some((item) => item.key === step)) {
    const own = COMMISSIONS_STEPS.find((item) => item.key === step)!;
    const at = steps.filter((item) => COMMISSIONS_STEPS.findIndex((s) => s.key === item.key) < COMMISSIONS_STEPS.indexOf(own)).length;
    steps.splice(at, 0, step === "reconciliation" && pathname === MY_PAY.href ? { ...own, ...MY_PAY, group: undefined } : own);
  }
  const heading = title ?? commissionsStepLabel(step, pathname);
  return (
    <StepFrame
      title={heading}
      titleInfo={info ? <InfoTip label={`About ${heading}`} side="right">{info}</InfoTip> : titleInfo}
      breadcrumbs={breadcrumbs}
      tabs={tabs}
      actions={actions}
      rail={{ label: "Commissions", cookie: COMMISSIONS_RAIL_COOKIE, countsUrl: "/api/app/commissions/steps", waiting: COMMISSIONS_WAITING, steps, step, collapsed: jar.get(COMMISSIONS_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { StepFrame } from "@/components/app/step-frame/step-frame";
import type { RailStep } from "@/components/app/step-frame/step-rail";
import { RETENTION_RAIL_COOKIE, RETENTION_STEPS, retentionStepLabel, type RetentionStep } from "@/lib/retention/steps";

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
  if (radar.entitled && actAsPage(radar, worker)) open.add("save");
  if (servicing.entitled && actAsPage(servicing, worker)) open.add("servicing");
  if (winback.entitled && actAsPage(winback, worker)) open.add("reinstatement");
  return RETENTION_STEPS.filter((item) => open.has(item.key));
}

/** The frame: the shared StepFrame with this page's steps and rail. `lead`: the step's own tabs. */
export async function RetentionPage({ step, lead, actions, children }: { step: RetentionStep; lead?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const [steps, jar] = await Promise.all([openSteps(), cookies()]);
  // The step on screen is always offered: its route already let this person in.
  if (!steps.some((item) => item.key === step)) {
    const own = RETENTION_STEPS.find((item) => item.key === step)!;
    const at = steps.filter((item) => RETENTION_STEPS.findIndex((s) => s.key === item.key) < RETENTION_STEPS.indexOf(own)).length;
    steps.splice(at, 0, own);
  }
  return (
    <StepFrame
      title={retentionStepLabel(step)}
      lead={lead}
      actions={actions}
      rail={{ label: "Retention", cookie: RETENTION_RAIL_COOKIE, steps, step, collapsed: jar.get(RETENTION_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

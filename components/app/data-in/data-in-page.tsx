import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { StepFrame } from "@/components/app/step-frame/step-frame";
import { DATA_IN_RAIL_COOKIE, DATA_IN_STEPS, DATA_IN_WAITING, dataInStepLabel, type DataInStep } from "@/lib/dataIn/steps";

/**
 * Data in, one page (owner 2026-11-02, the Reports and Compliance treatment): Carrier files, Import your
 * book, Policy matching and Exceptions are four steps down a rail on the left, the step on the right.
 *
 * Each step keeps its own address and its own route's gate (`/app/carrier-files`, `/app/book-import`,
 * `/app/policy-matching`, `/app/exceptions`), so every old link, alert and email still lands on the right
 * screen; the route renders its screen inside this frame. The rail offers only the steps this person may
 * open, by the same rules those routes apply.
 */
async function openSteps(): Promise<Set<DataInStep>> {
  const guard = await guardPage("statement_ingestion");
  const open = new Set<DataInStep>();
  if (!guard.entitled) return open;
  if (actAsPagePermission(guard, "statements.view")) { open.add("files"); open.add("import"); open.add("matching"); }
  // Exceptions: premiums inside (policies.view), and never a narrow agency session (AG-0.5), as its route.
  if (actAsPagePermission(guard, "policies.view") && (await scopeFor(guard.context)) === null) open.add("exceptions");
  return open;
}

/** The frame: the shared StepFrame, with this page's steps, rail and badges. */
export async function DataInPage({ step, lead, actions, children }: { step: DataInStep; lead?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const [open, jar] = await Promise.all([openSteps(), cookies()]);
  // The step on screen is always offered: its route already let this person in.
  open.add(step);
  return (
    <StepFrame
      title={dataInStepLabel(step)}
      lead={lead}
      actions={actions}
      rail={{ label: "Data in", cookie: DATA_IN_RAIL_COOKIE, countsUrl: "/api/app/data-in/steps", waiting: DATA_IN_WAITING, steps: DATA_IN_STEPS.filter((item) => open.has(item.key)), step, collapsed: jar.get(DATA_IN_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

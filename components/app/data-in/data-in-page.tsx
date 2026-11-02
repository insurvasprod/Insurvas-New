import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { StepFrame } from "@/components/app/step-frame/step-frame";
import { BOOK_AREA_LABEL, DATA_IN_RAIL_COOKIE, DATA_IN_STEPS, DATA_IN_WAITING, dataInStepLabel, type DataInStep } from "@/lib/dataIn/steps";

/**
 * Book of business, one area (owner 2026-11-02, round 2): Files, Needs you, Policies and Setup are four steps
 * down a rail on the left, the step on the right. A record under a step — a file, a row, an item, a policy, a
 * rule — is a detail page in the same frame: `title` names the record, the rail stays on its step.
 *
 * Each route keeps its own gate, so every old link, alert and email still lands on the right screen; the
 * route renders its screen inside this frame. The rail offers only the steps this person may open, by the
 * same rules those routes apply.
 */
async function openSteps(): Promise<Set<DataInStep>> {
  const [files, book] = await Promise.all([guardPage("statement_ingestion"), guardPage("book_of_business")]);
  const open = new Set<DataInStep>();
  if (files.entitled && actAsPagePermission(files, "statements.view")) { open.add("files"); open.add("setup"); }
  // Needs you: premiums inside (policies.view); each item kind applies its own rule on top.
  if (files.entitled && actAsPagePermission(files, "policies.view")) open.add("needs-you");
  if (book.entitled && actAsPage(book, ["owner", "producer", "bookkeeper"])) open.add("policies");
  return open;
}

/** The frame: the shared StepFrame, with this area's steps, rail and badges. */
export async function DataInPage({ step, title, lead, actions, children }: { step: DataInStep; title?: string; lead?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const [open, jar] = await Promise.all([openSteps(), cookies()]);
  // The step on screen is always offered: its route already let this person in.
  open.add(step);
  return (
    <StepFrame
      title={title ?? dataInStepLabel(step)}
      lead={lead}
      actions={actions}
      rail={{ label: BOOK_AREA_LABEL, cookie: DATA_IN_RAIL_COOKIE, countsUrl: "/api/app/data-in/steps", waiting: DATA_IN_WAITING, steps: DATA_IN_STEPS.filter((item) => open.has(item.key)), step, collapsed: jar.get(DATA_IN_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

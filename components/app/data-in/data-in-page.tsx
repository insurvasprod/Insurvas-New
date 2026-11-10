import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPage, actAsPagePermission, guardPage } from "@/lib/entitlements/guardPage";
import { StepFrame } from "@/components/app/step-frame/step-frame";
import type { Crumb } from "@/components/ui/breadcrumbs";
import { AREA_COOKIES, AREA_LABELS, DATA_IN_WAITING, SETUP_STEP_KEYS, areaOfStep, areaSteps, dataInStepLabel, type DataInStep } from "@/lib/dataIn/steps";

/**
 * Book of business (Carrier files, Policies, Commission ledger) and Carrier sync (Needs you, Setup): each one
 * area, its steps down a rail on the left, the step on the right (split 2026-11-05; one area since 2026-11-02).
 * A record under a step — a file, a row, an item, a policy, a rule — is a detail page in the same frame:
 * `title` names the record, the rail stays on its step.
 *
 * Each route keeps its own gate, so every old link, alert and email still lands on the right screen; the
 * route renders its screen inside this frame. The rail offers only the steps this person may open, by the
 * same rules those routes apply.
 */
async function openSteps(): Promise<Set<DataInStep>> {
  const [files, book, ledger] = await Promise.all([guardPage("statement_ingestion"), guardPage("book_of_business"), guardPage("commission_ledger")]);
  const open = new Set<DataInStep>();
  if (files.entitled && actAsPagePermission(files, "statements.view")) {
    open.add("files");
    // Setup's five tabs, each a step since 2026-11-05: one rule for all, as the Setup step had.
    for (const key of SETUP_STEP_KEYS) open.add(key);
  }
  // Needs you: premiums inside (policies.view); each item kind applies its own rule on top.
  if (files.entitled && actAsPagePermission(files, "policies.view")) open.add("needs-you");
  if (book.entitled && actAsPage(book, ["owner", "producer", "bookkeeper"])) open.add("policies");
  // The Commission ledger (from Commissions, 2026-11-05): /app/ledger's own rule.
  if (ledger.entitled && actAsPage(ledger, ["owner", "producer", "bookkeeper"])) open.add("ledger");
  return open;
}

/** The frame: the shared StepFrame, with the step's area, its rail and badges. */
export async function DataInPage({ step, title, chip, facts, tabs, actions, breadcrumbs, children }: {
  step: DataInStep;
  title?: string;
  /** A record's status chip, beside its title (round 3, owner 2026-11-02). */
  chip?: ReactNode;
  /** A record's one muted line of facts, under its title. */
  facts?: ReactNode;
  /** The step's sub-pages or views (ViewTabs): the sub-page bar under the title. */
  tabs?: ReactNode;
  actions?: ReactNode;
  /** A record under a record (a file's row): its own trail, so the parent record is a link. */
  breadcrumbs?: Crumb[];
  children: ReactNode;
}) {
  const [open, jar] = await Promise.all([openSteps(), cookies()]);
  // The step on screen is always offered: its route already let this person in.
  open.add(step);
  const area = areaOfStep(step);
  const cookie = AREA_COOKIES[area];
  return (
    <StepFrame
      title={title ?? dataInStepLabel(step)}
      titleInfo={chip}
      meta={facts}
      tabs={tabs}
      actions={actions}
      breadcrumbs={breadcrumbs}
      rail={{ label: AREA_LABELS[area], cookie, countsUrl: "/api/app/data-in/steps", waiting: DATA_IN_WAITING, steps: areaSteps(area).filter((item) => open.has(item.key)), step, collapsed: jar.get(cookie)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

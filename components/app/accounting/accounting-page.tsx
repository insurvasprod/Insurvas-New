import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { StepFrame } from "@/components/app/step-frame/step-frame";
import type { RailStep } from "@/components/app/step-frame/step-rail";
import { ACCOUNTING_RAIL_COOKIE, ACCOUNTING_STEPS, ACCOUNTING_WAITING, MY_BALANCE, accountingStepLabel, type AccountingStep } from "@/lib/accounting/steps";

/**
 * Accounting, one page (owner 2026-11-02, the Data in treatment): Profit & loss, Bank deposits, Vendor
 * bills, Expenses, Producer splits and Tax summaries are six steps down a rail on the left, the step on
 * the right. Vendor returns stays the Returns tab of Vendor bills; My balance is the Splits step for a
 * producer.
 *
 * Each step keeps its own address and its own route's gate (`/app/pnl`, `/app/bank`, `/app/vendor-bills`,
 * `/app/vendor-returns`, `/app/expenses`, `/app/producer-splits`, `/app/my-balance`, `/app/tax`), so every
 * old link still lands on the right screen. The rail offers only the steps this person may open, by the
 * same rules those routes apply.
 */
async function openSteps(): Promise<RailStep[]> {
  const [money, returns, tax] = await Promise.all([guardPage("profit_and_loss"), guardPage("true_cpa"), guardPage("tax_summaries")]);
  const keeper = money.entitled && actAsPage(money, ["owner", "bookkeeper"]);
  const producer = money.entitled && actAsPage(money, ["producer"]);
  // Vendor bills opens on invoices (owner, bookkeeper) or on returns (also a producer; never a narrow agency session).
  const mayReturns = returns.entitled && actAsPage(returns, ["owner", "producer", "bookkeeper"]) && (await scopeFor(returns.context)) === null;
  const open = new Set<AccountingStep>();
  if (keeper) { open.add("pnl"); open.add("bank"); open.add("expenses"); open.add("splits"); }
  if (producer) open.add("splits");
  if (keeper || mayReturns) open.add("bills");
  if (tax.entitled && actAsPage(tax, ["owner", "bookkeeper"])) open.add("tax");
  return ACCOUNTING_STEPS.filter((item) => open.has(item.key)).map((item) => {
    if (item.key === "splits" && !keeper) return { ...item, ...MY_BALANCE };
    if (item.key === "bills" && !keeper) return { ...item, href: "/app/vendor-returns" };
    return item;
  });
}

/**
 * The frame: the shared StepFrame with this page's steps, rail and badges. `pathname` names the address on
 * screen, so My balance keeps its own title.
 */
export async function AccountingPage({ step, pathname, lead, actions, children }: { step: AccountingStep; pathname?: string; lead?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const [steps, jar] = await Promise.all([openSteps(), cookies()]);
  // The step on screen is always offered: its route already let this person in.
  if (!steps.some((item) => item.key === step)) {
    const own = ACCOUNTING_STEPS.find((item) => item.key === step)!;
    steps.splice(ACCOUNTING_STEPS.indexOf(own), 0, step === "splits" && pathname === MY_BALANCE.href ? { ...own, ...MY_BALANCE } : own);
  }
  return (
    <StepFrame
      title={accountingStepLabel(step, pathname)}
      lead={lead}
      actions={actions}
      rail={{ label: "Accounting", cookie: ACCOUNTING_RAIL_COOKIE, countsUrl: "/api/app/accounting/steps", waiting: ACCOUNTING_WAITING, steps, step, collapsed: jar.get(ACCOUNTING_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

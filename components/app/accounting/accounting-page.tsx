import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { scopeFor } from "@/lib/agency/visibility";
import { getPlanAudience } from "@/lib/agency/audience";
import { StepFrame } from "@/components/app/step-frame/step-frame";
import { InfoTip } from "@/components/ui/info-tip";
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
  const [money, returns, tax, payouts, producerPay] = await Promise.all([guardPage("profit_and_loss"), guardPage("true_cpa"), guardPage("tax_summaries"), guardPage("payout_runs"), guardPage("producer_payouts")]);
  const keeper = money.entitled && actAsPage(money, ["owner", "bookkeeper"]);
  // One producer pay (owner 2026-11-03, "merge them"). A solo agent's plan has none (LA-7.5: agencies only). On
  // an agency it is AG-1.5/1.7's (Producer payouts + Commission splits, My pay; decision D5: one ledger), so the
  // LA-7.5 Splits step, its writer already off there (D4), is offered only to a tenant with neither audience.
  // The plan's audience and the session's scope are both read here, after the page's own data: at once, not one after
  // the other (perf pass 2026-11-08).
  const returnsRole = returns.entitled && actAsPage(returns, ["owner", "producer", "bookkeeper"]);
  const [audience, scope] = await Promise.all([
    money.entitled ? getPlanAudience(money.context.tenantId) : null,
    returnsRole ? scopeFor(returns.context) : undefined,
  ]);
  const legacySplits = audience !== "individual" && audience !== "agency";
  const producer = money.entitled && actAsPage(money, ["producer"]);
  // Vendor bills opens on invoices (owner, bookkeeper) or on returns (also a producer; never a narrow agency session).
  const mayReturns = returnsRole && scope === null;
  const open = new Set<AccountingStep>();
  if (keeper) { open.add("pnl"); open.add("bank"); open.add("expenses"); if (legacySplits) open.add("splits"); }
  if (producer && legacySplits) open.add("splits");
  if (keeper || mayReturns) open.add("bills");
  if (tax.entitled && actAsPage(tax, ["owner", "bookkeeper"])) open.add("tax");
  if (payouts.entitled && actAsPage(payouts, ["owner", "bookkeeper"])) open.add("payouts");
  // AG-1.7 / AG-1.6 (owner 2026-11-03, out of Team): the agency's producer payouts and commission splits, by their routes' rule.
  if (producerPay.entitled && actAsPage(producerPay, ["owner", "bookkeeper"])) { open.add("producerPayouts"); open.add("commissionSplits"); }
  return ACCOUNTING_STEPS.filter((item) => open.has(item.key)).map((item) => {
    if (item.key === "splits" && !keeper) return { ...item, ...MY_BALANCE };
    if (item.key === "bills" && !keeper) return { ...item, href: "/app/vendor-returns" };
    return item;
  });
}

/**
 * The frame: the shared StepFrame with this page's steps, rail and badges. `pathname` names the address on
 * screen, so My balance keeps its own title.
 *
 * Foundation pass (2026-11-03, docs/accounting/FOUNDATION-PASS.md), as Book of business: everything above the
 * step is on the title line. `lead` holds the step's tabs, `actions` at most two buttons and a More menu, and
 * `info` the step's (i) (what used to be a sentence over the table). A record under a step (an invoice, a
 * producer, a payee) passes its `title`, its status `chip` and one muted line of `facts`.
 */
export async function AccountingPage({ step, pathname, title, info, chip, facts, lead, actions, children }: {
  step: AccountingStep;
  pathname?: string;
  title?: string;
  info?: ReactNode;
  chip?: ReactNode;
  facts?: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [steps, jar] = await Promise.all([openSteps(), cookies()]);
  // The step on screen is always offered: its route already let this person in.
  if (!steps.some((item) => item.key === step)) {
    const own = ACCOUNTING_STEPS.find((item) => item.key === step)!;
    steps.splice(ACCOUNTING_STEPS.indexOf(own), 0, step === "splits" && pathname === MY_BALANCE.href ? { ...own, ...MY_BALANCE } : own);
  }
  return (
    <StepFrame
      title={title ?? accountingStepLabel(step, pathname)}
      titleInfo={info || chip ? <>{info ? <InfoTip label={`About ${title ?? accountingStepLabel(step, pathname)}`} side="right">{info}</InfoTip> : null}{chip}</> : undefined}
      // The facts never widen the title's column (it sizes to its content beside the tabs): they wrap in it,
      // at least 360px wide, so a long line cannot squeeze the tabs at 1280 (walk 2026-11-03).
      meta={facts ? <p className="mt-1 text-sm text-muted-foreground lg:min-w-[360px] lg:[contain:inline-size]">{facts}</p> : undefined}
      lead={lead}
      actions={actions}
      rail={{ label: "Accounting", cookie: ACCOUNTING_RAIL_COOKIE, countsUrl: "/api/app/accounting/steps", waiting: ACCOUNTING_WAITING, steps, step, collapsed: jar.get(ACCOUNTING_RAIL_COOKIE)?.value === "collapsed" }}
    >
      {children}
    </StepFrame>
  );
}

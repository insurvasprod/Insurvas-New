import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { accountFacts, BankError, listAccounts, matchQueue, openStatements, paymentResults } from "@/lib/accounting/bankStore";
import { addDays, depositFilterOf, legacyBankAddress, orderPayments, paymentHref, paymentsFrom, type BankTab } from "@/lib/accounting/bankResultsCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountsBoard, BankTitleActions, DepositsBoard } from "@/components/app/accounting/bank-board";
import { BankResults, type ResultListRow } from "@/components/app/accounting/bank-results";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Bank deposits (LA-7.6, Notion sprint). What actually landed in the bank, matched by a person to what the
 * carriers said they paid. Owner and bookkeeper only.
 *
 * Round 7 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html § 1, direction B "Two questions"): three tabs on
 * the title line, each its own address — Payments (`?view=payments`, did each carrier pay right? red count =
 * missing money + bad math), Deposits (`?view=deposits`, is every bank line explained? count = lines to match) and
 * Accounts (`?view=accounts`). The old addresses still land: results → payments, queue and unexplained → deposits
 * on To match, not_received → payments on Missing money. `?view=deposits&match=<bank line id>` opens that line's
 * Match dialog (Accounting › To do links here); `&step=1` steps through every line to match. `?add=1` on Accounts
 * opens Add an account.
 */
const TABS: BankTab[] = ["payments", "deposits", "accounts"];
const PERIODS = ["30", "90", "365"];

type Query = { view?: string; add?: string; period?: string; show?: string; match?: string; step?: string; account?: string };

export default async function BankPage({ searchParams }: { searchParams: Promise<Query> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Bank deposits" description="What actually landed in the bank." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Bank deposits" detail="Only owners and bookkeepers can see the agency's bank lines." />;
  }
  const q = await searchParams;
  const moved = legacyBankAddress(q);
  if (moved) redirect(moved);
  const tab = TABS.find((v) => v === q.view) ?? (q.match ? "deposits" : "payments");
  const period = PERIODS.find((p) => p === q.period) ?? "90";
  const readOnly = guard.entitlement.access === "read_only";
  const tenantId = guard.context.tenantId;
  // Frame first (UI-CONSISTENCY §7a): everything the tabs read is started now and awaited by the blocks below.
  const read: BankRead = load(tenantId, period, tab === "accounts").then(
    (loaded) => ({ loaded, problem: null }),
    (error: unknown) => {
      if (!(error instanceof BankError)) throw error;
      return { loaded: null, problem: error.message };
    },
  );
  // Until it lands: the same tabs without counts, and the tab's buttons with no account yet (their menu items off).
  const tabsOf = (counts: { payments: number | undefined; deposits: number | undefined; accounts: number } | null) => (
    <ViewTabs label="Bank deposits" value={tab} tabs={[
      { key: "payments", label: "Payments", count: counts?.payments, tone: "danger", href: "/app/bank?view=payments" },
      { key: "deposits", label: "Deposits", count: counts?.deposits, href: "/app/bank?view=deposits" },
      { key: "accounts", label: "Accounts", count: counts?.accounts, href: "/app/bank?view=accounts" },
    ]} />
  );
  return (
    <AccountingPage
      step="bank"
      info={<Suspense fallback={bankInfo(DEFAULT_WINDOW_DAYS)}><BankInfo read={read} /></Suspense>}
      tabs={<Suspense fallback={tabsOf(null)}><BankTabs read={read} tabsOf={tabsOf} /></Suspense>}
      actions={<Suspense fallback={<BankTitleActions tab={tab} accounts={[]} readOnly={readOnly} review={null} toMatch={0} />}><BankActions read={read} tab={tab} period={period} readOnly={readOnly} /></Suspense>}
    >
      <StreamSection shape={tab === "payments" ? "strip+table" : "table"}>
        <BankBody read={read} tab={tab} period={period} q={q} readOnly={readOnly} />
      </StreamSection>
    </AccountingPage>
  );
}

type BankRead = Promise<{ loaded: Awaited<ReturnType<typeof load>> | null; problem: string | null }>;

/** The match window's default (Settings › Accounting), for the (i) until the tenant's own is read. */
const DEFAULT_WINDOW_DAYS = 21;
const bankInfo = (windowDays: number) => `Did the money the carriers said they paid land in the bank, and was each policy paid what you were promised? A deposit counts when it lands from the carrier's date to ${windowDays} days after (Settings › Accounting). Promised amounts come from your rate card. Nothing is matched until a person confirms it.`;

async function BankInfo({ read }: { read: BankRead }) {
  const { loaded } = await read;
  return bankInfo(loaded?.results.windowDays ?? DEFAULT_WINDOW_DAYS);
}

const toMatchOf = (loaded: Awaited<ReturnType<typeof load>>) => loaded.txns.filter((t) => depositFilterOf(t.status) === "to_match").length;

async function BankTabs({ read, tabsOf }: { read: BankRead; tabsOf: (counts: { payments: number | undefined; deposits: number | undefined; accounts: number } | null) => ReactNode }) {
  const { loaded } = await read;
  if (!loaded) return null;
  return tabsOf({
    payments: loaded.results.rows.filter((r) => r.verdict === "missing_money" || r.verdict === "bad_math").length || undefined,
    deposits: toMatchOf(loaded) || undefined,
    accounts: loaded.accounts.length,
  });
}

async function BankActions({ read, tab, period, readOnly }: { read: BankRead; tab: BankTab; period: string; readOnly: boolean }) {
  const { loaded } = await read;
  if (!loaded) return null;
  const worst = orderPayments(loaded.results.rows).filter((r) => r.verdict === "bad_math");
  const review = worst.length ? { count: worst.length, href: paymentHref(worst[0].id, paymentsFrom(period, "bad_math")) } : null;
  return <BankTitleActions tab={tab} accounts={loaded.accounts} readOnly={readOnly} review={review} toMatch={toMatchOf(loaded)} />;
}

async function BankBody({ read, tab, period, q, readOnly }: { read: BankRead; tab: BankTab; period: string; q: Query; readOnly: boolean }) {
  const { loaded, problem } = await read;
  if (!loaded) return <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
  const { accounts, txns, statements, facts, results } = loaded;
  return tab === "payments"
    ? <BankResults key={`${period}-${q.show ?? ""}`} rows={results.rows} period={period} show={q.show} bankThrough={results.bankThrough} hasAccounts={accounts.length > 0} />
    : tab === "deposits"
      ? <DepositsBoard key={`${q.match ?? ""}-${q.step ?? ""}`} data={{ accounts, txns, statements }} readOnly={readOnly} show={q.show} account={q.account} openId={q.match} stepping={q.step === "1"} />
      : <AccountsBoard key={q.add ?? ""} accounts={accounts} facts={facts} readOnly={readOnly} adding={q.add === "1"} />;
}

/** Everything the three tabs and their counts read, at once. The account facts are read for Accounts only. */
async function load(tenantId: string, period: string, withFacts: boolean) {
  const today = new Date().toISOString().slice(0, 10);
  const [accounts, txns, statements, paid] = await Promise.all([listAccounts(tenantId), matchQueue(tenantId, "all"), openStatements(tenantId), paymentResults(tenantId, { since: addDays(today, -Number(period)), today })]);
  const facts = withFacts ? await accountFacts(tenantId, accounts.map((a) => a.id)) : [];
  const label = new Map(accounts.map((a) => [a.id, `${a.nickname}${a.lastFour ? ` ••${a.lastFour}` : ""}`]));
  const rows: ResultListRow[] = paid.rows.map((r) => ({
    id: r.id, carrierId: r.carrierId, carrierName: r.carrierName, statementDate: r.statementDate, paidCents: r.paidCents, verdict: r.verdict, missingCents: r.missingCents, shortCents: r.shortCents, dueBy: r.dueBy,
    deposit: r.deposits[0] ? { postedOn: r.deposits[0].postedOn, amountCents: r.deposits[0].appliedCents, account: label.get(r.deposits[0].accountId) ?? "Bank" } : null,
    depositCount: r.deposits.length,
    policies: { total: r.policies.length, ok: r.policies.filter((p) => p.state === "ok" || p.state === "over").length, short: r.policies.filter((p) => p.state === "short").length, noPromise: r.policies.filter((p) => p.state === "no_promise").length },
  }));
  return { accounts, txns, statements, facts, results: { rows, windowDays: paid.windowDays, bankThrough: paid.bankThrough } };
}

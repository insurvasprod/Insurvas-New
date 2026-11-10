import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { redirect } from "next/navigation";

import { BankError, findings, listAccounts, matchQueue, openStatements, paymentResults } from "@/lib/accounting/bankStore";
import { addDays } from "@/lib/accounting/bankResultsCore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { BankActions, BankBoard, type BankData, type BankView } from "@/components/app/accounting/bank-board";
import { BankResults, type ResultListRow } from "@/components/app/accounting/bank-results";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Bank deposits (LA-7.6, Notion sprint). What actually landed in the bank, matched by a
 * person to what the carriers said they paid. Owner and bookkeeper only.
 *
 * Foundation pass (2026-11-03): the step's tabs sit on the title line, each at its own address (`?view=`);
 * `?add=1` opens the Add an account row.
 *
 * The Bank Matchmaker (owner's Accounting doc, round 1 B2/B6 pick A, 2026-11-07): Results is the first tab —
 * one verdict per carrier payment (All good · Missing money · Bad math). It takes in the old "Not received"
 * tab, whose address now lands on Results filtered to Missing money.
 */
type PageView = BankView | "results";
const VIEWS: PageView[] = ["results", "queue", "unexplained", "accounts"];
const PERIODS = ["30", "90", "365"];

export default async function BankPage({ searchParams }: { searchParams: Promise<{ view?: string; add?: string; period?: string; show?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Bank deposits" description="What actually landed in the bank." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Bank deposits" detail="Only owners and bookkeepers can see the agency's bank lines." />;
  }
  const q = await searchParams;
  if (q.view === "not_received") redirect("/app/bank?view=results&show=missing_money");
  const view = VIEWS.find((v) => v === q.view) ?? "results";
  const period = PERIODS.find((p) => p === q.period) ?? "90";
  const readOnly = guard.entitlement.access === "read_only";
  const tenantId = guard.context.tenantId;
  let data: BankData | null = null;
  let results: { rows: ResultListRow[]; windowDays: number; bankThrough: string | null } | null = null;
  let problem: string | null = null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [accounts, queue, statements, found, paid] = await Promise.all([listAccounts(tenantId), matchQueue(tenantId), openStatements(tenantId), findings(tenantId), paymentResults(tenantId, { since: addDays(today, -Number(period)), today })]);
    data = { accounts, queue, statements, findings: found };
    const label = new Map(accounts.map((a) => [a.id, `${a.nickname}${a.lastFour ? ` ••${a.lastFour}` : ""}`]));
    results = {
      windowDays: paid.windowDays,
      bankThrough: paid.bankThrough,
      rows: paid.rows.map((r) => ({
        id: r.id, carrierName: r.carrierName, statementDate: r.statementDate, paidCents: r.paidCents, verdict: r.verdict, missingCents: r.missingCents, shortCents: r.shortCents, dueBy: r.dueBy,
        deposit: r.deposits[0] ? { postedOn: r.deposits[0].postedOn, amountCents: r.deposits[0].appliedCents, account: label.get(r.deposits[0].accountId) ?? "Bank" } : null,
        depositCount: r.deposits.length,
        policies: { total: r.policies.length, ok: r.policies.filter((p) => p.state === "ok" || p.state === "over").length, short: r.policies.filter((p) => p.state === "short").length, noPromise: r.policies.filter((p) => p.state === "no_promise").length },
      })),
    };
  } catch (error) {
    if (!(error instanceof BankError)) throw error;
    problem = error.message;
  }
  const tabs = data ? (
    <ViewTabs label="Bank deposits" value={view} tabs={[
      { key: "results", label: "Results", count: results?.rows.filter((r) => r.verdict === "missing_money" || r.verdict === "bad_math").length || undefined, tone: "danger", href: "/app/bank" },
      { key: "queue", label: "To match", count: data.queue.length, href: "/app/bank?view=queue" },
      { key: "unexplained", label: "Not explained", count: data.findings.unexplained.length, href: "/app/bank?view=unexplained" },
      { key: "accounts", label: "Accounts", count: data.accounts.length, href: "/app/bank?view=accounts" },
    ]} />
  ) : undefined;
  return (
    <AccountingPage
      step="bank"
      info={`Did the money the carriers said they paid land in the bank, and was each policy paid what you were promised? A deposit counts when it lands from the carrier's date to ${results?.windowDays ?? 21} days after (Settings › Accounting). Promised amounts come from your rate card. Nothing is matched until a person confirms it.`}
      tabs={tabs}
      actions={data ? (view === "results"
        ? (!readOnly ? <Button asChild><Link href="/app/bank/check">Check a payment</Link></Button> : undefined)
        : <BankActions accounts={data.accounts} readOnly={readOnly} />) : undefined}
    >
      {data && results && view === "results"
        ? <BankResults key={`${period}-${q.show ?? ""}`} rows={results.rows} period={period} show={q.show} bankThrough={results.bankThrough} hasAccounts={data.accounts.length > 0} />
        : data && view !== "results" ? <BankBoard key={view} data={data} view={view} adding={q.add === "1"} readOnly={readOnly} />
        : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>}
    </AccountingPage>
  );
}

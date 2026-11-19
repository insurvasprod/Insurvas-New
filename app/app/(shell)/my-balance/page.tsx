import { canSeeProducerRow } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { getPlanAudience } from "@/lib/agency/audience";
import { myBalance, ProducerError } from "@/lib/accounting/producerStore";
import { policyHref } from "@/lib/ingestion/fileStages";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EntriesTable, RunsTable, type EntryFilter, type EntryKind } from "@/components/app/accounting/producers-board";
import { dateLabel, monthYearLabel } from "@/lib/accounting/producerLabels";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { formatCentsAsCurrency } from "@/lib/money";

/**
 * Money › My balance (LA-7.5, Notion sprint). A producer's own split balance and why — including
 * the chargebacks that made it negative — before the conversation, not when a cheque fails to
 * arrive. Their share only; never what the agency grossed.
 *
 * Foundation pass (2026-11-03): Entries · Payout runs are the step's tabs on the title line (`?view=runs`).
 * Round 7, 4·4 (owner 2026-11-10): still read-only, but an entry opens its policy (the producer's own policy
 * page, when their plan and role open Policies) and a run row opens that run's statement, read-only.
 */
const KIND: Record<string, EntryKind> = { split_advance: "share", split_earned: "share", split_chargeback: "chargeback" };

export default async function MyBalancePage({ searchParams }: { searchParams: Promise<{ view?: string; show?: string; run?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="My balance" description="Your share of the commission, and what has come back." />;
  }
  if (!actAsPage(guard, ["producer"])) {
    return <RoleGateNotice featureLabel="My balance" detail="This page is a producer's own balance. Owners and bookkeepers see every producer at Producer splits." action={{ href: "/app/producer-splits", label: "Open Producer splits" }} />;
  }
  // LA-7.5 (Notion): producer splits are for agencies; a solo agent's plan never shows them.
  // One producer pay (owner 2026-11-03, "merge them"): on an agency the ledger is AG-1.5's and its screens are
  // My pay, so this LA-7.5 screen hands over to it. A solo agent's plan has no producer pay at all.
  const audience = await getPlanAudience(guard.context.tenantId);
  if (audience === "agency") redirect("/app/my-pay");
  if (audience === "individual") return <RoleGateNotice reason="solo" featureLabel="My balance" detail="Producer splits share commission between an agency and its producers, so they open once you work as an agency." action={{ href: "/app/pnl", label: "Open Profit & loss" }} />;
  // Gate checks above; the address and the policy page's own gate are gates too, read at once.
  const [asked, book] = await Promise.all([searchParams, guardPage("book_of_business")]);
  const view = asked.view === "runs" ? "runs" : "entries";
  const show: EntryFilter = asked.show === "shares" || asked.show === "chargebacks" ? asked.show : "all";
  // The policy page's own gate (Policies: book_of_business, a producer may open it, scoped to their book there).
  const policyLinks = book.entitled && actAsPage(book, ["producer"]);
  // Frame first (UI-CONSISTENCY §7a): the balance is read now and awaited by the blocks below, so the title line draws at once.
  const read: BalanceRead = (async () => {
    try {
      // AG-0.5: only ever the session's own balance; a scope that ever excluded self (a failed read closes it) shows nothing.
      const data = (await canSeeProducerRow(guard.context, guard.context.userId)) ? await myBalance(guard.context.tenantId, guard.context.userId) : null;
      return { data, problem: null };
    } catch (error) {
      if (!(error instanceof ProducerError)) throw error;
      return { data: null, problem: error.message };
    }
  })();
  const tabsOf = (shown: { entries: unknown[]; runs: unknown[] } | null) => (
    <ViewTabs label="My balance" value={view} tabs={[
      { key: "entries", label: "Entries", count: shown ? shown.entries.length : null, href: "/app/my-balance" },
      { key: "runs", label: "Payout runs", count: shown ? shown.runs.length : null, href: "/app/my-balance?view=runs" },
    ]} />
  );
  return (
    <AccountingPage
      step="splits"
      pathname="/app/my-balance"
      info="Your share of the commission the agency received, and the chargebacks that come back with it. Only your own figures."
      tabs={<Suspense fallback={tabsOf(null)}><BalanceTabs read={read} tabsOf={tabsOf} /></Suspense>}
    >
      <StreamSection shape="strip+table">
        <BalanceBody read={read} view={view} show={show} run={asked.run} policyLinks={policyLinks} />
      </StreamSection>
    </AccountingPage>
  );
}

type BalanceRead = Promise<{ data: Awaited<ReturnType<typeof myBalance>> | null; problem: string | null }>;

/** The step's tabs with their counts, once the balance is read (the fallback draws the same tabs without counts). */
async function BalanceTabs({ read, tabsOf }: { read: BalanceRead; tabsOf: (shown: { entries: unknown[]; runs: unknown[] } | null) => ReactNode }) {
  const { data } = await read;
  return data?.visible ? tabsOf(data) : null;
}

async function BalanceBody({ read, view, show, run, policyLinks }: { read: BalanceRead; view: "entries" | "runs"; show: EntryFilter; run?: string; policyLinks: boolean }) {
  const { data, problem } = await read;
  const money = (c: number) => formatCentsAsCurrency(c);
  const shown = data?.visible ? data : null;
  const year = new Date().toISOString().slice(0, 4);
  const paidThisYear = shown ? shown.runs.filter((r) => r.status === "paid" && (r.paidOn ?? r.periodEnd).startsWith(year)) : [];
  const lastRun = shown?.runs[0];
  const rows = shown ? shown.entries.map((e) => ({
    id: e.id, occurredOn: e.occurredOn, what: e.label, reason: e.reason, policyNumber: e.policyNumber, split: null, amountCents: e.amountCents, kind: KIND[e.entryType] ?? ("other" as const),
    href: policyLinks && e.policyNumber && e.carrierId ? policyHref(e.carrierId, e.policyNumber) : null,
  })) : [];
  if (!data) return <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
  if (!shown) return <TableCard><EmptyState title="Not shared" hint="Your agency has not turned on producer balances. Ask the owner." /></TableCard>;
  return (
    <>
      <StatStrip label="Your balance">
        <StatTile label={shown.owesAgency ? "You owe the agency" : "The agency owes you"} value={money(Math.abs(shown.balanceCents))} footnote={shown.owesAgency ? <StatusChip tone="danger">Chargebacks beyond earnings</StatusChip> : "not yet paid out"} href={shown.owesAgency ? "/app/my-balance?show=chargebacks" : "/app/my-balance?show=shares"} />
        <StatTile label="Paid to you this year" value={money(paidThisYear.reduce((s, r) => s + r.netCents, 0))} footnote={`${paidThisYear.length} run${paidThisYear.length === 1 ? "" : "s"}`} href="/app/my-balance?view=runs" />
        <StatTile label="Last run" value={lastRun ? money(lastRun.netCents) : "—"} footnote={lastRun ? `${monthYearLabel(lastRun.periodStart)} · ${lastRun.status === "paid" && lastRun.paidOn ? `paid ${dateLabel(lastRun.paidOn)}` : "published"}` : "none published yet"} href={lastRun ? `/app/my-balance?view=runs&run=${lastRun.id}` : "/app/my-balance?view=runs"} />
      </StatStrip>
      {view === "runs"
        ? <RunsTable key={run ?? "runs"} runs={shown.runs} readOnly mine openRunId={run} />
        : <EntriesTable key={show} rows={rows} show={show} mine />}
    </>
  );
}

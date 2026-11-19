import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { redirect } from "next/navigation";

import { getPlanAudience } from "@/lib/agency/audience";
import { NEGATIVE_POLICY_LABELS, percent, type NegativePolicy } from "@/lib/accounting/producersCore";
import { ProducerError, producersOverview, syncProducerLedger } from "@/lib/accounting/producerStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { ProducersBoard, PublishDrafts, type ProducerFilter, type ProducersView } from "@/components/app/accounting/producers-board";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { EmptyState } from "@/components/ui/page-states";
import { StreamSection } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Money › Producer splits (LA-7.5, Notion sprint). Each producer's share of the commission the
 * agency received, the chargebacks that come back with it, and their payout runs. Owner and
 * bookkeeper only; producers see their own balance at My balance.
 *
 * Foundation pass (2026-11-03): Producers · Payout runs are the step's tabs on the title line (`?view=runs`);
 * the agency's negative-balance rule is the title's (i), with its link to Accounting settings.
 * Round 7, 4·A (owner 2026-11-10): a row opens the producer or the run; "Publish N drafts one by one" is the
 * title line's primary while drafts wait; `?show=owes|nosplit` lands on the list's chip (the strip's links).
 */
export default async function ProducerSplitsPage({ searchParams }: { searchParams: Promise<{ view?: string; show?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="Producer splits" description="What each producer is owed, and what they owe back." />;
  }
  if (!actAsPage(guard, ["owner", "bookkeeper"])) {
    return <RoleGateNotice featureLabel="Producer splits" detail="Only owners and bookkeepers can see every producer's balance." />;
  }
  // LA-7.5 (Notion): producer splits are for agencies; a solo agent's plan never shows them.
  // One producer pay (owner 2026-11-03, "merge them"): on an agency the ledger is AG-1.5's and its screens are
  // Producer payouts and Commission splits, so this LA-7.5 screen hands over to it. A solo agent's plan has no producer pay at all.
  const audience = await getPlanAudience(guard.context.tenantId);
  if (audience === "agency") redirect("/app/producer-payouts");
  if (audience === "individual") return <RoleGateNotice reason="solo" featureLabel="Producer splits" detail="Producer splits share commission between an agency and its producers, so they open once you work as an agency." action={{ href: "/app/pnl", label: "Open Profit & loss" }} />;
  const asked = await searchParams;
  const view: ProducersView = asked.view === "runs" ? "runs" : "producers";
  const show: ProducerFilter = asked.show === "owes" || asked.show === "nosplit" ? asked.show : "all";
  const readOnly = guard.entitlement.access === "read_only";
  // Frame first (UI-CONSISTENCY §7a): the ledger sync and the overview are read now; the title, the two tabs and the
  // (i) draw at once, the counts, the rule and Publish when they land.
  const read: SplitsRead = (async () => {
    try {
      if (!readOnly) await syncProducerLedger(guard.context.tenantId);
      return { data: await producersOverview(guard.context.tenantId), problem: null };
    } catch (error) {
      if (!(error instanceof ProducerError)) throw error;
      return { data: null, problem: error.message };
    }
  })();
  const tabsOf = (counts: { people: number; drafts: number } | null) => (
    <ViewTabs label="Producer splits" value={view} tabs={[
      { key: "producers", label: "Producers", count: counts?.people ?? null, href: "/app/producer-splits" },
      { key: "runs", label: "Payout runs", count: counts?.drafts || null, href: "/app/producer-splits?view=runs" },
    ]} />
  );
  return (
    <AccountingPage
      step="splits"
      info={<Suspense fallback={RULE_LEAD}><SplitsInfo read={read} /></Suspense>}
      tabs={<Suspense fallback={tabsOf(null)}><SplitsTabs read={read} tabsOf={tabsOf} /></Suspense>}
      actions={<Suspense fallback={null}><SplitsActions read={read} readOnly={readOnly} /></Suspense>}
    >
      <StreamSection shape="strip+table">
        <SplitsBody read={read} view={view} show={show} readOnly={readOnly} />
      </StreamSection>
    </AccountingPage>
  );
}

type SplitsRead = Promise<{ data: Awaited<ReturnType<typeof producersOverview>> | null; problem: string | null }>;
const RULE_LEAD = "A negative balance is shown, never reset.";
const draftsOf = (data: Awaited<ReturnType<typeof producersOverview>>) => data.runs.filter((r) => r.status === "draft");

async function SplitsInfo({ read }: { read: SplitsRead }) {
  const { data } = await read;
  if (!data) return RULE_LEAD;
  const policy = `${NEGATIVE_POLICY_LABELS[data.settings.negativePolicy as NegativePolicy] ?? data.settings.negativePolicy}${data.settings.negativePolicy === "cap" ? ` (at most ${percent(data.settings.recoveryCapBp)} of each payout)` : ""}`;
  return <>{RULE_LEAD} This agency&apos;s rule: {policy}. <Link className="underline" href="/app/accounting-settings">Change it in Accounting settings</Link>.</>;
}

async function SplitsTabs({ read, tabsOf }: { read: SplitsRead; tabsOf: (counts: { people: number; drafts: number } | null) => ReactNode }) {
  const { data } = await read;
  return data ? tabsOf({ people: data.people.length, drafts: draftsOf(data).length }) : null;
}

async function SplitsActions({ read, readOnly }: { read: SplitsRead; readOnly: boolean }) {
  const { data } = await read;
  const drafts = data ? draftsOf(data) : [];
  if (!data || !drafts.length) return null;
  const names = Object.fromEntries(data.people.map((p) => [p.userId, p.name]));
  return <PublishDrafts drafts={drafts} names={names} readOnly={readOnly} />;
}

async function SplitsBody({ read, view, show, readOnly }: { read: SplitsRead; view: ProducersView; show: ProducerFilter; readOnly: boolean }) {
  const { data, problem } = await read;
  return data ? <ProducersBoard key={show} data={data} view={view} show={show} readOnly={readOnly} /> : <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
}

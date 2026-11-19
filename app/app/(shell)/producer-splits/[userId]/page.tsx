import { notFound, redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { getPlanAudience } from "@/lib/agency/audience";
import { PRODUCER_ENTRY_LABELS, percent, type ProducerEntry } from "@/lib/accounting/producersCore";
import { ProducerError, producerEntries, producersOverview } from "@/lib/accounting/producerStore";
import { formatCentsAsCurrency } from "@/lib/money";
import { policyHref } from "@/lib/ingestion/fileStages";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { RecordStepper, neighboursOf } from "@/components/app/accounting/record-stepper";
import { AddSplitForm, EntriesTable, ProducerActions, RunsTable, SplitsTable, type EntryFilter, type EntryKind, type EntryRow } from "@/components/app/accounting/producers-board";
import { currentSplit, dateLabel, monthYearLabel, splitText } from "@/lib/accounting/producerLabels";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { StreamSection, TitleShape } from "@/components/ui/stream-section";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Accounting › Producer splits › a producer (LA-7.5; foundation pass 2026-11-03, was a side sheet).
 * Round 7, 4·1–4·2 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html): the title is the producer's name
 * alone; the facts line became the strip (Split · Balance · Owed to date · Clawed back · Last run), each
 * figure a link to the tab it counts. ‹ › name the neighbouring producers in the list's order. Entries opens
 * the policy behind each line; Splits' title-line primary is Add a split (a dialog); a run row opens the run
 * dialog. Owner and bookkeeper only; opening it writes nothing.
 */
type Tab = "entries" | "splits" | "runs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (c: number) => formatCentsAsCurrency(c);
const KIND: Record<string, EntryKind> = { split_advance: "share", split_earned: "share", split_chargeback: "chargeback" };
const OF_ENTRY: Record<string, string> = { split_advance: " of advance", split_earned: " of earned commission" };

/** A ledger line as the Entries tab draws it: the policy's Commissions tab is where it came from. */
function entryRow(e: ProducerEntry): EntryRow {
  return {
    id: e.id, occurredOn: e.occurredOn, what: PRODUCER_ENTRY_LABELS[e.entryType] ?? e.entryType, reason: e.reason, policyNumber: e.policyNumber,
    // LA-7.5: an entry opens what caused it, the commission on its policy (the policy's Commissions tab).
    href: e.policyNumber && e.carrierId ? policyHref(e.carrierId, e.policyNumber, "commissions") : null,
    split: e.splitPctBpApplied != null ? `${percent(e.splitPctBpApplied)}${OF_ENTRY[e.entryType] ?? ""}` : null,
    amountCents: e.amountCents, kind: KIND[e.entryType] ?? "other",
  };
}

export default async function ProducerPage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ tab?: string; show?: string; run?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) return <FeatureGateNotice guard={guard} featureLabel="Producer splits" description="What each producer is owed, and what they owe back." />;
  if (!actAsPage(guard, ["owner", "bookkeeper"])) return <RoleGateNotice featureLabel="Producer splits" detail="Only owners and bookkeepers can see every producer's balance." />;
  // One producer pay (owner 2026-11-03, "merge them"): on an agency the ledger is AG-1.5's and its screens are
  // Producer payouts and Commission splits, so this LA-7.5 screen hands over to it. A solo agent's plan has no producer pay at all.
  const audience = await getPlanAudience(guard.context.tenantId);
  if (audience === "agency") redirect("/app/producer-payouts");
  if (audience === "individual") return <RoleGateNotice reason="solo" featureLabel="Producer splits" detail="Producer splits share commission between an agency and its producers, so they open once you work as an agency." action={{ href: "/app/pnl", label: "Open Profit & loss" }} />;
  const { userId } = await params;
  if (!UUID.test(userId)) notFound();
  const asked = await searchParams;
  const tab: Tab = asked.tab === "splits" || asked.tab === "runs" ? asked.tab : "entries";
  const show: EntryFilter = asked.show === "shares" || asked.show === "chargebacks" ? asked.show : "all";
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  const base = `/app/producer-splits/${userId}`;
  const at = (t: Tab) => (t === "entries" ? base : `${base}?tab=${t}`);
  // Frame first (UI-CONSISTENCY §7a): the overview and this producer's entries are read now; the name streams in
  // behind a title shape, and the three tabs draw at once (their counts, ‹ › and the buttons when the data lands).
  const read: ProducerRead = (async () => {
    try {
      const [data, entries] = await Promise.all([producersOverview(tenantId), producerEntries(tenantId, userId)]);
      const person = data.people.find((p) => p.userId === userId);
      if (!person) notFound();
      return { loaded: { data, entries, person }, problem: null };
    } catch (error) {
      if (!(error instanceof ProducerError)) throw error;
      return { loaded: null, problem: error.message };
    }
  })();
  const tabsOf = (counts: { entries: number; splits: number; runs: number } | null) => (
    <ViewTabs label="This producer" value={tab} tabs={[
      { key: "entries", label: "Entries", count: counts?.entries ?? null, href: at("entries") },
      { key: "splits", label: "Splits", count: counts?.splits ?? null, tone: counts && !counts.splits ? "danger" : undefined, href: at("splits") },
      { key: "runs", label: "Payout runs", count: counts?.runs ?? null, href: at("runs") },
    ]} />
  );

  return (
    <AccountingPage
      step="splits"
      title={<Suspense fallback={<TitleShape />}><ProducerName read={read} /></Suspense>}
      tabs={<Suspense fallback={tabsOf(null)}><ProducerTabs read={read} tabsOf={tabsOf} /></Suspense>}
      stepper={<Suspense fallback={<span aria-hidden="true" className="h-9" />}><ProducerStepper read={read} tab={tab} /></Suspense>}
      actions={<Suspense fallback={null}><ProducerTitleActions read={read} tab={tab} readOnly={readOnly} /></Suspense>}
    >
      <StreamSection shape="strip+table">
        <ProducerBody read={read} tab={tab} show={show} run={asked.run} readOnly={readOnly} />
      </StreamSection>
    </AccountingPage>
  );
}

type Overview = Awaited<ReturnType<typeof producersOverview>>;
type ProducerRead = Promise<{ loaded: { data: Overview; entries: Awaited<ReturnType<typeof producerEntries>>; person: Overview["people"][number] } | null; problem: string | null }>;

async function ProducerName({ read }: { read: ProducerRead }) {
  const { loaded } = await read;
  return loaded ? loaded.person.name : "Producer";
}

async function ProducerTabs({ read, tabsOf }: { read: ProducerRead; tabsOf: (counts: { entries: number; splits: number; runs: number } | null) => ReactNode }) {
  const { loaded } = await read;
  if (!loaded) return null;
  const { data, entries, person } = loaded;
  return tabsOf({ entries: entries.length, splits: data.splits.filter((s) => s.producerUserId === person.userId).length, runs: data.runs.filter((r) => r.producerUserId === person.userId).length });
}

async function ProducerStepper({ read, tab }: { read: ProducerRead; tab: Tab }) {
  const { loaded } = await read;
  if (!loaded) return null;
  const { data, person } = loaded;
  // ‹ › walk the Producers list in the order it is drawn, staying on the same tab.
  const near = neighboursOf(data.people, person.userId, (p) => p.userId);
  const neighbour = (p: typeof person | null) => (p ? { href: `/app/producer-splits/${p.userId}${tab === "entries" ? "" : `?tab=${tab}`}`, label: p.name } : null);
  return <RecordStepper previous={neighbour(near.previous)} next={neighbour(near.next)} noun="producer" />;
}

async function ProducerTitleActions({ read, tab, readOnly }: { read: ProducerRead; tab: Tab; readOnly: boolean }) {
  const { loaded } = await read;
  if (!loaded) return null;
  const { data, person } = loaded;
  return tab === "splits" ? <AddSplitForm person={person} carriers={data.carriers} defaults={data.settings} readOnly={readOnly} /> : <ProducerActions person={person} readOnly={readOnly} />;
}

async function ProducerBody({ read, tab, show, run, readOnly }: { read: ProducerRead; tab: Tab; show: EntryFilter; run?: string; readOnly: boolean }) {
  const { loaded, problem } = await read;
  if (!loaded) return <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>;
  const { data, entries, person } = loaded;
  const userId = person.userId;
  const splits = data.splits.filter((s) => s.producerUserId === userId);
  const runs = data.runs.filter((r) => r.producerUserId === userId);
  const current = currentSplit(data.splits, userId);
  const rows = entries.map(entryRow);
  const chargebacks = rows.filter((e) => e.kind === "chargeback").length;
  const firstShare = rows.filter((e) => e.kind === "share").at(-1);
  const lastRun = runs.find((r) => r.status !== "void");
  const base = `/app/producer-splits/${userId}`;
  const at = (t: Tab) => (t === "entries" ? base : `${base}?tab=${t}`);
  const carried = data.settings.negativePolicy === "cap" ? "recovered from the next runs" : data.settings.negativePolicy === "write_off" ? "to write off" : "carried";
  const otherRules = splits.filter((s) => s.id !== current?.id).length;

  return (
    <>
    <StatStrip label={`${person.name}'s balance`}>
      <StatTile label="Split" valueSize="text" value={splitText(current)} footnote={current ? `from ${dateLabel(current.effectiveFrom)} · all carriers${otherRules ? ` · ${otherRules} more rule${otherRules === 1 ? "" : "s"}` : ""}` : <StatusChip tone="danger">Nothing is owed until one is</StatusChip>} href={at("splits")} />
      <StatTile label="Balance" value={money(person.balanceCents)} footnote={person.balanceCents < 0 ? <><StatusChip tone="danger">Owes the agency</StatusChip> {carried}</> : person.balanceCents > 0 ? "owed to them" : "settled"} />
      <StatTile label="Owed to date" value={money(person.owedCents)} footnote={firstShare ? `since ${monthYearLabel(firstShare.occurredOn)}` : "no shares yet"} href={`${base}?show=shares`} />
      <StatTile label="Clawed back" value={money(person.clawedBackCents)} footnote={`${chargebacks} chargeback${chargebacks === 1 ? "" : "s"}`} href={`${base}?show=chargebacks`} />
      <StatTile label="Last run" value={lastRun ? money(lastRun.netCents) : "—"} footnote={lastRun ? `${monthYearLabel(lastRun.periodStart)} · ${lastRun.status === "paid" && lastRun.paidOn ? `paid ${dateLabel(lastRun.paidOn)}` : lastRun.status}` : "no runs yet"} href={lastRun ? `${base}?tab=runs&run=${lastRun.id}` : at("runs")} />
    </StatStrip>
    {tab === "runs" ? <RunsTable key={run ?? "runs"} runs={runs} readOnly={readOnly} openRunId={run} />
      : tab === "splits" ? <SplitsTable splits={splits} carriers={data.carriers} />
      : <EntriesTable key={show} rows={rows} show={show} />}
    </>
  );
}

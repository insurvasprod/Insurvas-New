import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { getPlanAudience } from "@/lib/agency/audience";
import { BASIS_LABELS, PAYS_ON_LABELS, PRODUCER_ENTRY_LABELS, percent } from "@/lib/accounting/producersCore";
import { ProducerError, producerEntries, producersOverview } from "@/lib/accounting/producerStore";
import { formatCentsAsCurrency } from "@/lib/money";
import { policyHref } from "@/lib/ingestion/fileStages";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { AddSplitForm, ProducerActions, RunsTable } from "@/components/app/accounting/producers-board";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Accounting › Producer splits › a producer (LA-7.5; foundation pass 2026-11-03, was a side sheet). The title is
 * the producer with whether they are owed or owe the agency, one line of facts, Draft a run and More; the
 * tabs are Entries (every share and chargeback, newest first), Splits (the effective-dated rules and Add a
 * split) and Payout runs. Owner and bookkeeper only; opening it writes nothing.
 */
type Tab = "entries" | "splits" | "runs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (c: number) => formatCentsAsCurrency(c);

export default async function ProducerPage({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams: Promise<{ tab?: string }> }) {
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
  const asked = (await searchParams).tab;
  const tab: Tab = asked === "splits" || asked === "runs" ? asked : "entries";
  const tenantId = guard.context.tenantId;
  const readOnly = guard.entitlement.access === "read_only";
  let loaded: { data: Awaited<ReturnType<typeof producersOverview>>; entries: Awaited<ReturnType<typeof producerEntries>> } | null = null;
  let problem: string | null = null;
  try {
    const [data, entries] = await Promise.all([producersOverview(tenantId), producerEntries(tenantId, userId)]);
    loaded = { data, entries };
  } catch (error) {
    if (!(error instanceof ProducerError)) throw error;
    problem = error.message;
  }
  if (!loaded) return <AccountingPage step="splits" title="Producer"><TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard></AccountingPage>;
  const { data, entries } = loaded;
  const person = data.people.find((p) => p.userId === userId);
  if (!person) notFound();
  const splits = data.splits.filter((s) => s.producerUserId === userId);
  const runs = data.runs.filter((r) => r.producerUserId === userId);
  const today = new Date().toISOString().slice(0, 10);
  const current = splits.find((s) => !s.carrierId && !s.productCode && s.effectiveFrom <= today);
  const carrier = (id: string | null) => (id ? data.carriers.find((c) => c.id === id)?.name ?? "Carrier" : "All carriers");
  const owes = person.balanceCents < 0;
  const base = `/app/producer-splits/${userId}`;
  const facts = [current ? `${percent(current.splitPctBp)} of ${current.basis === "both" ? "advance + earned" : current.basis}` : "No split recorded", `Balance ${money(person.balanceCents)}`, `Owed to date ${money(person.owedCents)}`, `Clawed back ${money(person.clawedBackCents)}`].join(" · ");

  return (
    <AccountingPage
      step="splits"
      title={person.name}
      chip={<StatusChip tone={owes ? "warning" : person.balanceCents > 0 ? "info" : "neutral"}>{owes ? "Owes the agency" : person.balanceCents > 0 ? "Owed" : "Settled"}</StatusChip>}
      facts={facts}
      tabs={<ViewTabs label={person.name} value={tab} tabs={[
        { key: "entries", label: "Entries", count: entries.length, href: base },
        { key: "splits", label: "Splits", count: splits.length, tone: splits.length ? undefined : "danger", href: `${base}?tab=splits` },
        { key: "runs", label: "Payout runs", count: runs.length, href: `${base}?tab=runs` },
      ]} />}
      actions={<ProducerActions person={person} readOnly={readOnly} />}
    >
      {tab === "runs" ? <RunsTable runs={runs} readOnly={readOnly} />
        : tab === "splits" ? (
          <>
            <TableCard>
              {splits.length === 0 ? <EmptyState title="No split recorded" hint="Nothing is owed to this producer until one is." /> : (
                <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
                  <thead><tr><th className="w-[130px]">From</th><th className="w-[100px] text-right">Share</th><th>Of</th><th>Carrier</th><th>Product</th><th>Owed</th></tr></thead>
                  <tbody>{splits.map((s) => <tr key={s.id}><td className="tabular-nums">{s.effectiveFrom}</td><td className="text-right tabular-nums">{percent(s.splitPctBp)}</td><td>{BASIS_LABELS[s.basis]}</td><td>{carrier(s.carrierId)}</td><td>{s.productCode ?? "All products"}</td><td>{PAYS_ON_LABELS[s.paysOn]}</td></tr>)}</tbody>
                </table>
              )}
            </TableCard>
            {!readOnly ? <AddSplitForm person={person} carriers={data.carriers} defaults={data.settings} /> : null}
          </>
        ) : (
          <PagedTableCard total={entries.length} noun="entries">
            {entries.length === 0 ? <EmptyState title="Nothing yet" hint="Shares appear here as the carriers' commission arrives." /> : (
              <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
                <thead><tr><th className="w-[120px]">Date</th><th>What</th><th className="w-[160px]">Policy</th><th className="w-[90px] text-right">Split</th><th className="w-[140px] text-right">Amount</th></tr></thead>
                <PagedBody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="tabular-nums">{e.occurredOn}</td>
                      <td>{PRODUCER_ENTRY_LABELS[e.entryType] ?? e.entryType}{e.reason ? <div className="text-xs text-muted-foreground">{e.reason}</div> : null}</td>
                      {/* LA-7.5: an entry opens what caused it, the commission on its policy (the policy's Commissions tab). */}
                      <td className="font-mono text-xs">{e.policyNumber && e.carrierId ? <Link className="text-[var(--accent-ink)] hover:underline" href={policyHref(e.carrierId, e.policyNumber, "commissions")}>{e.policyNumber}</Link> : e.policyNumber ?? "—"}</td>
                      <td className="text-right tabular-nums">{e.splitPctBpApplied != null ? percent(e.splitPctBpApplied) : "—"}</td>
                      <td className={`text-right tabular-nums ${e.amountCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(e.amountCents)}</td>
                    </tr>
                  ))}
                </PagedBody>
              </table>
            )}
          </PagedTableCard>
        )}
    </AccountingPage>
  );
}

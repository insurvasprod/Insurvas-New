import { canSeeProducerRow } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { redirect } from "next/navigation";

import { getPlanAudience } from "@/lib/agency/audience";
import { myBalance, ProducerError } from "@/lib/accounting/producerStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { AccountingPage } from "@/components/app/accounting/accounting-page";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { EmptyState } from "@/components/ui/page-states";
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
 * Foundation pass (2026-11-03): Entries · Payout runs are the step's tabs on the title line (`?view=runs`),
 * each one paged list.
 */
export default async function MyBalancePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="My balance" description="Your share of the commission, and what has come back." />;
  }
  if (!actAsPage(guard, ["producer"])) {
    return <RoleGateNotice featureLabel="My balance" detail="This page is a producer's own balance. Owners and bookkeepers see every producer at Producer splits." />;
  }
  // LA-7.5 (Notion): producer splits are for agencies; a solo agent's plan never shows them.
  // One producer pay (owner 2026-11-03, "merge them"): on an agency the ledger is AG-1.5's and its screens are
  // My pay, so this LA-7.5 screen hands over to it. A solo agent's plan has no producer pay at all.
  const audience = await getPlanAudience(guard.context.tenantId);
  if (audience === "agency") redirect("/app/my-pay");
  if (audience === "individual") return <RoleGateNotice reason="solo" featureLabel="My balance" detail="Producer splits share commission between an agency and its producers, so they open once you work as an agency." action={{ href: "/app/pnl", label: "Open Profit & loss" }} />;
  const view = (await searchParams).view === "runs" ? "runs" : "entries";
  let data: Awaited<ReturnType<typeof myBalance>> | null = null;
  let problem: string | null = null;
  try {
    // AG-0.5: only ever the session's own balance; a scope that ever excluded self (a failed read closes it) shows nothing.
    if (await canSeeProducerRow(guard.context, guard.context.userId)) data = await myBalance(guard.context.tenantId, guard.context.userId);
  } catch (error) {
    if (!(error instanceof ProducerError)) throw error;
    problem = error.message;
  }
  const money = (c: number) => formatCentsAsCurrency(c);
  const shown = data?.visible ? data : null;
  return (
    <AccountingPage
      step="splits"
      pathname="/app/my-balance"
      info="Your share of the commission the agency received, and the chargebacks that come back with it. Only your own figures."
      tabs={shown ? <ViewTabs label="My balance" value={view} tabs={[
        { key: "entries", label: "Entries", count: shown.entries.length, href: "/app/my-balance" },
        { key: "runs", label: "Payout runs", count: shown.runs.length, href: "/app/my-balance?view=runs" },
      ]} /> : undefined}
    >
      {!data ? <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
        : !shown ? <TableCard><EmptyState title="Not shared" hint="Your agency has not turned on producer balances. Ask the owner." /></TableCard>
        : (
          <>
            <StatStrip label="Your balance">
              <StatTile label={shown.owesAgency ? "You owe the agency" : "The agency owes you"} value={money(Math.abs(shown.balanceCents))} valueTone={shown.owesAgency ? "danger" : undefined} footnote={shown.owesAgency ? "chargebacks beyond what you earned" : "not yet paid out"} href="/app/my-balance" />
              <StatTile label="Payout runs" value={String(shown.runs.length)} footnote="published to you" href="/app/my-balance?view=runs" />
            </StatStrip>
            {view === "runs" ? (
              <PagedTableCard total={shown.runs.length} noun="runs">
                {shown.runs.length === 0 ? <EmptyState title="No payout runs yet" hint="A run shows here once the agency publishes it to you." /> : (
                  <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
                    <thead><tr><th>Period</th><th className="text-right">Earned</th><th className="text-right">Clawed back</th><th className="text-right">Withheld</th><th className="text-right">Paid to you</th><th className="w-[140px]">Status</th></tr></thead>
                    <PagedBody>
                      {shown.runs.map((r) => (
                        <tr key={r.id}><td>{r.periodStart} to {r.periodEnd}</td><td className="text-right tabular-nums">{money(r.earnedCents)}</td><td className="text-right tabular-nums">{money(r.clawedBackCents)}</td><td className="text-right tabular-nums">{money(r.withheldCents)}</td><td className="text-right tabular-nums font-medium">{money(r.netCents)}</td><td><StatusChip tone={r.status === "paid" ? "good" : "info"}>{r.status === "paid" ? `Paid ${r.paidOn ?? ""}` : "Published"}</StatusChip></td></tr>
                      ))}
                    </PagedBody>
                  </table>
                )}
              </PagedTableCard>
            ) : (
              <PagedTableCard total={shown.entries.length} noun="entries">
                {shown.entries.length === 0 ? <EmptyState title="Nothing yet" hint="Your share appears here as the carriers' commission arrives." /> : (
                  <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
                    <thead><tr><th className="w-[120px]">Date</th><th>What</th><th className="w-[140px] text-right">Your share</th></tr></thead>
                    <PagedBody>
                      {shown.entries.map((e) => (
                        <tr key={e.id}><td className="tabular-nums">{e.occurredOn}</td><td>{e.label}{e.policyNumber ? ` · policy ${e.policyNumber}` : ""}{e.reason ? <div className="text-xs text-muted-foreground">{e.reason}</div> : null}</td><td className={`text-right tabular-nums ${e.amountCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(e.amountCents)}</td></tr>
                      ))}
                    </PagedBody>
                  </table>
                )}
              </PagedTableCard>
            )}
          </>
        )}
    </AccountingPage>
  );
}

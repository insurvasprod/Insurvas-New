import { canSeeProducerRow } from "@/lib/agency/visibility";
import { actAsPage, guardPage } from "@/lib/entitlements/guardPage";
import { myBalance, ProducerError } from "@/lib/accounting/producerStore";
import { FeatureGateNotice } from "@/components/app/feature-gate-notice";
import { RoleGateNotice } from "@/components/app/role-gate-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { formatCentsAsCurrency } from "@/lib/money";

/**
 * Money › My balance (LA-7.5, Notion sprint). A producer's own split balance and why — including
 * the chargebacks that made it negative — before the conversation, not when a cheque fails to
 * arrive. Their share only; never what the agency grossed.
 */
export default async function MyBalancePage() {
  const guard = await guardPage("profit_and_loss");
  if (!guard.entitled) {
    return <FeatureGateNotice guard={guard} featureLabel="My balance" description="Your share of the commission, and what has come back." />;
  }
  if (!actAsPage(guard, ["producer"])) {
    return <RoleGateNotice featureLabel="My balance" detail="This page is a producer's own balance. Owners and bookkeepers see every producer at Producer splits." />;
  }
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
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="My balance" description="Your share of the commission, and what has come back." />
      {!data ? <TableCard><EmptyState title="Not switched on yet" hint={problem ?? ""} /></TableCard>
        : !data.visible ? <TableCard><EmptyState title="Not shared" hint="Your agency has not turned on producer balances. Ask the owner." /></TableCard>
        : (
          <>
            <StatStrip label="Your balance">
              <StatTile label={data.owesAgency ? "You owe the agency" : "The agency owes you"} value={money(Math.abs(data.balanceCents))} valueTone={data.owesAgency ? "danger" : undefined} footnote={data.owesAgency ? "chargebacks beyond what you earned" : "not yet paid out"} />
              <StatTile label="Payout runs" value={String(data.runs.length)} footnote="published to you" />
            </StatStrip>
            <TableCard>
              {data.entries.length === 0 ? <EmptyState title="Nothing yet" hint="Your share appears here as the carriers' commission arrives." /> : (
                <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
                  <thead><tr><th className="w-[120px]">Date</th><th>What</th><th className="w-[140px] text-right">Your share</th></tr></thead>
                  <tbody>
                    {data.entries.map((e) => (
                      <tr key={e.id}><td>{e.occurredOn}</td><td>{e.label}{e.policyNumber ? ` · policy ${e.policyNumber}` : ""}{e.reason ? <div className="text-xs text-muted-foreground">{e.reason}</div> : null}</td><td className={`text-right tabular-nums ${e.amountCents < 0 ? "text-[var(--error-ink)]" : ""}`}>{money(e.amountCents)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TableCard>
            {data.runs.length ? (
              <TableCard>
                <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
                  <thead><tr><th>Period</th><th className="text-right">Earned</th><th className="text-right">Clawed back</th><th className="text-right">Withheld</th><th className="text-right">Paid to you</th><th className="w-[140px]">Status</th></tr></thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.id}><td>{r.periodStart} to {r.periodEnd}</td><td className="text-right tabular-nums">{money(r.earnedCents)}</td><td className="text-right tabular-nums">{money(r.clawedBackCents)}</td><td className="text-right tabular-nums">{money(r.withheldCents)}</td><td className="text-right tabular-nums font-medium">{money(r.netCents)}</td><td><StatusChip tone={r.status === "paid" ? "good" : "info"}>{r.status === "paid" ? `Paid ${r.paidOn ?? ""}` : "Published"}</StatusChip></td></tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            ) : null}
          </>
        )}
    </div>
  );
}

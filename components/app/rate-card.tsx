"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { RowAction, RowActionCell } from "@/components/ui/row-action";
import { bpToPercent, TRIGGER_LABELS } from "@/lib/ingestion/expectedCommission";
import type { RateCardCarrier } from "@/lib/ingestion/expectedCommissionStore";

const whole = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/**
 * LA-4.13 (Notion sprint) · the rate card, carrier by carrier: what is set (pays on, lag, your contract level,
 * rates), what is missing, and how much of the book that leaves unchecked. Owner 2026-11-19 (board ledger-r1
 * 2·A): a row opens the carrier's own page, /app/rate-card/[carrierId], where its level, rates, advances and
 * products are tables edited in place — no longer a scrolling pop-up.
 */
export function RateCardWorkspace({ carriers, readOnly }: { carriers: RateCardCarrier[]; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  return (
    <>
      <PagedTableCard total={carriers.length} noun="carriers" toolbar={<DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}><span className="text-sm text-muted-foreground">Largest monthly premium first</span></DataToolbar>}>
        {carriers.length === 0 ? (
          <EmptyState title="No policies from carrier files yet" hint="The rate card is set up per carrier you hold policies with. Import your book first." />
        ) : (
          <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr>
                <th className="min-w-[180px]">Carrier</th>
                <th className="w-[100px] text-right" title="Monthly premium on hover">Policies</th>
                <th className="w-[150px]" title="When the carrier pays: on issue, or once the first premium drafts">Pays</th>
                <th className="w-[110px] text-right" title="Your contract level with the carrier">Your level</th>
                <th className="w-[150px]" title="Policies the rate card can price today">Can be checked</th>
                <th className="w-[120px] text-right">Next step</th>
              </tr>
            </thead>
            <PagedBody>
              {carriers.map((c) => {
                const share = c.monthlyCents ? Math.floor((c.pricedMonthlyCents * 100) / c.monthlyCents) : 0;
                // Round 6: the verb says what is missing — "Add rates" while policies can't be priced.
                const verb = readOnly ? "Open" : c.policies > 0 && c.pricedPolicies === c.policies ? "Edit Rates" : "Add Rates";
                const href = `/app/rate-card/${c.carrierId}`;
                const openRow = () => router.push(href);
                return (
                  <tr key={c.carrierId} className="cursor-pointer" onClick={openRow}>
                    <td className="whitespace-nowrap font-medium text-foreground">{c.carrierName}</td>
                    <td className="whitespace-nowrap text-right tabular-nums" title={`${whole(c.monthlyCents)} monthly premium`}>{c.policies.toLocaleString("en-US")}</td>
                    <td className="whitespace-nowrap" title={c.trigger ? (c.lagDays !== null ? `Usually within ${c.lagDays} days` : "Lag not set") : undefined}>{c.trigger ? TRIGGER_LABELS[c.trigger] : "Not set"}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{c.levelBp !== null ? `${bpToPercent(c.levelBp)}%` : "Not set"}</td>
                    <td>
                      {c.policies === 0 ? <span className="text-muted-foreground" title="No policies yet">—</span> : (
                        <StatusChip tone={c.pricedPolicies === c.policies ? "good" : c.pricedPolicies ? "warning" : "danger"} title={`${share}% of premium`}>{c.pricedPolicies === c.policies ? "All" : c.pricedPolicies ? `${c.pricedPolicies} of ${c.policies}` : "None"}</StatusChip>
                      )}
                    </td>
                    <RowActionCell><RowAction href={href} title={`${c.schedules.length} ${c.schedules.length === 1 ? "rate" : "rates"} set`}>{verb}</RowAction></RowActionCell>
                  </tr>
                );
              })}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>
    </>
  );
}

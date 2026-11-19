"use client";

import { useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { OfferCalendar } from "@/components/admin/billing/offer-calendar";
import { OfferSheet } from "@/components/admin/billing/offer-sheet";
import { fullDate } from "@/components/admin/tenant-record/billing-format";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { formatCentsAsCurrency } from "@/lib/money";
import type { OfferRow } from "@/lib/offers/constants";
import { OFFER_STATE, overlappingOffers, ruleOf, stateOf, targetOf, type OfferState } from "@/lib/offers/present";
import type { OfferCustomer } from "@/lib/offers/qualify";
import type { PlanListRow } from "@/lib/plans/constants";
import { cn } from "@/lib/utils";

const STATES: readonly OfferState[] = ["active", "scheduled", "ended", "inactive"];

/**
 * The offers board (admin round 1, billing-r2 screen 9): the campaign layer over coupons. The list (one line a row,
 * newest start first) and the calendar of windows side by side; a row or a bar opens the offer as a wide right sheet,
 * and "New offer" opens the same sheet empty. Search, the Target and Status filters, the open offer (`?offer=`) and
 * the new sheet (`?new=1`) live in the URL. Everything reads one render time (`now`, from the server) so server and
 * browser agree on which offers have started; after a write the page reads again.
 */
export function OffersTable({ offers, plans, customers, now }: {
  offers: OfferRow[];
  plans: PlanListRow[];
  /** Every subscription that is not cancelled, with its offer context. A cancelled one is never offered in Apply. */
  customers: OfferCustomer[];
  now: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const query = params.get("q") ?? "";
  const target = params.get("target") ?? "";
  const stateParam = params.get("status");
  const stateFilter: "" | OfferState = stateParam && (STATES as readonly string[]).includes(stateParam) ? (stateParam as OfferState) : "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const openId = params.get("offer");
  const creating = params.get("new") === "1";

  const planName = useMemo(() => { const map = new Map(plans.map((p) => [p.id, p.name])); return (id: string) => map.get(id); }, [plans]);
  const overlapping = useMemo(() => overlappingOffers(offers, now), [offers, now]);
  const overlapIds = useMemo(() => new Set(overlapping.map((row) => row.offer.id)), [overlapping]);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () => offers
      .map((offer) => ({ offer, state: stateOf(offer, now) }))
      .filter(({ offer, state }) =>
        (!stateFilter || state === stateFilter)
        && (!target || (target === "all" ? offer.eligible_plan_ids.length === 0 : offer.eligible_plan_ids.length === 0 || offer.eligible_plan_ids.includes(target)))
        && (!needle || offer.name.toLowerCase().includes(needle) || (offer.coupon?.code ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => Date.parse(b.offer.starts_at ?? b.offer.created_at) - Date.parse(a.offer.starts_at ?? a.offer.created_at)),
    [offers, now, stateFilter, target, needle],
  );
  const pageSize = useFittingPageSize(480, 45);
  const { current, rows: shown } = paginate(rows, page, pageSize);
  const anyFilter = Boolean(needle || target || stateFilter);
  const filter = (patch: Record<string, string | null>) => setParamsInPlace({ ...patch, page: null });
  const clear = () => filter({ q: null, target: null, status: null });
  const refresh = () => startRefresh(() => router.refresh());
  const open = openId ? offers.find((o) => o.id === openId) ?? null : null;

  return (
    <>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <TableCard
          className="min-w-0"
          footer={rows.length ? <Pager page={current} pageSize={pageSize} total={rows.length} noun={rows.length === 1 ? "offer" : "offers"} suffix="latest start first" onPage={(next) => setParamsInPlace({ page: next > 1 ? String(next) : null })} /> : undefined}
          toolbar={
            <DataToolbar actions={<RefreshButton onClick={refresh} refreshing={refreshing} />}>
              <ToolbarSearch value={query} onChange={(value) => filter({ q: value || null })} placeholder="Search offer or coupon" />
              <select aria-label="Target" value={target} onChange={(event) => filter({ target: event.target.value || null })} className={cn(toolbarControl, "max-w-56")}>
                <option value="">All targets</option>
                <option value="all">Every plan (no plan restriction)</option>
                {plans.filter((p) => !p.is_archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select aria-label="Status" value={stateFilter} onChange={(event) => filter({ status: event.target.value || null })} className={toolbarControl}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="scheduled">Scheduled</option>
                <option value="ended">Ended</option>
                <option value="inactive">Deactivated</option>
              </select>
              {anyFilter && <Button type="button" variant="ghost" onClick={clear}>Clear</Button>}
            </DataToolbar>
          }
        >
          {shown.length === 0 ? (
            anyFilter ? <NoMatches noun="offers" onClear={clear} /> : <EmptyState title="No offers yet" hint="An offer applies a discount to whoever qualifies, without touching each customer." />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Offer</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead className="text-right">Redemptions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead><span className="sr-only">Open</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(({ offer, state }) => {
                  const clash = overlapping.find((row) => row.offer.id === offer.id);
                  const openRow = () => setParamsInPlace({ offer: offer.id, new: null });
                  const target = targetOf(offer, planName);
                  return (
                    <TableRow key={offer.id} className="cursor-pointer" onClick={openRow} aria-selected={openId === offer.id}>
                      <TableCell className="max-w-[14rem] truncate font-semibold text-foreground" title={`${offer.coupon?.code ?? "No coupon"} · ${offer.auto_apply ? "applied automatically" : "manual only"}`}>
                        <button type="button" className="hover:underline" onClick={(event) => { event.stopPropagation(); openRow(); }}>{offer.name}</button>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{ruleOf(offer)}</TableCell>
                      <TableCell className="max-w-[14rem] truncate" title={target}>{target}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{offer.starts_at ? fullDate(offer.starts_at) : "Now"} – {offer.ends_at ? fullDate(offer.ends_at) : "no end"}</TableCell>
                      <TableCell className="text-right tabular-nums" title={`${formatCentsAsCurrency(offer.discount_given_cents)} given`}>
                        {offer.redeemed_count.toLocaleString("en-US")}{offer.max_redemptions === null ? "" : ` / ${offer.max_redemptions.toLocaleString("en-US")}`}
                      </TableCell>
                      <TableCell>
                        {clash
                          ? <StatusChip tone="warning" title={`Could apply together with ${clash.with.map((o) => o.name).join(", ")}`}>{OFFER_STATE[state].label} · overlaps</StatusChip>
                          : <StatusChip tone={OFFER_STATE[state].tone} dot>{OFFER_STATE[state].label}</StatusChip>}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground" aria-hidden="true">›</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TableCard>

        <OfferCalendar offers={offers} now={now} overlapping={overlapIds} onOpen={(id) => setParamsInPlace({ offer: id, new: null })} />
      </div>

      {(creating || open) && (
        <OfferSheet
          key={creating ? "new" : open!.id}
          offer={creating ? null : open}
          offers={offers}
          overlapsWith={creating || !open ? [] : overlapping.find((row) => row.offer.id === open.id)?.with ?? []}
          plans={plans}
          customers={customers}
          now={now}
          onClose={() => setParamsInPlace({ offer: null, new: null })}
          onSaved={(created) => {
            setParamsInPlace(created ? { new: null, offer: created.id } : {});
            refresh();
          }}
        />
      )}
    </>
  );
}

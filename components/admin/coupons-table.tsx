"use client";

import { useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CouponCreateSheet } from "@/components/admin/coupon-create-dialog";
import { COUPON_CHIP, CouponSheet } from "@/components/admin/billing/coupon-sheet";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import type { CouponRow } from "@/lib/coupons/constants";
import type { CouponStatus } from "@/lib/coupons/discount";
import {
  COUPON_STATUS_LABEL,
  EXPIRING_SOON_DAYS,
  describeDiscount,
  describeRedemptions,
  describeRestrictions,
  matchesExpiry,
  sortActiveFirst,
  statusOf,
  utcDay,
  utcDayTime,
  type CouponPlanRef,
  type ExpiryFilter,
} from "@/lib/coupons/format";
import type { CouponOfferRef, CouponRedemption } from "@/lib/coupons/queries";
import { formatCentsAsCurrency } from "@/lib/money";

type StatusFilter = "all" | CouponStatus;
type TypeFilter = "any" | "percent" | "fixed";

const STATUSES: readonly StatusFilter[] = ["all", "active", "deactivated", "expired", "exhausted"];
const TYPES: readonly TypeFilter[] = ["any", "percent", "fixed"];
const EXPIRIES: readonly ExpiryFilter[] = ["any", "soon", "dated", "none"];
const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T => (value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);

/**
 * The coupons list (admin round 1, billing-r2 screen 8): one TableCard with its toolbar inside and the pager at its
 * foot, one line a row, the status the row's one chip. A row opens the coupon as a right sheet.
 *
 * Every coupon is on the client (tens, not thousands), so search, the filters and paging are instant and the counts
 * exact. The search, the filters, the open coupon (`?coupon=`) and the create sheet (`?new=1`, `&from=<id>` to
 * duplicate) live in the URL without a round trip (setParamsInPlace), so a link or a reload lands on the same view.
 * `nowIso` comes from the server so a coupon's status is decided once and the browser cannot disagree with it.
 */
export function CouponsTable({
  coupons,
  plans,
  discountGiven,
  redemptions,
  offersByCoupon,
  nowIso,
  listError,
}: {
  coupons: CouponRow[];
  /** Null when the plans could not be read. */
  plans: (CouponPlanRef & { is_archived: boolean })[] | null;
  /** Cents off our invoices per coupon id; null when it could not be read. */
  discountGiven: Record<string, number> | null;
  /** Applications per coupon id; null when they could not be read. */
  redemptions: Record<string, CouponRedemption[]> | null;
  /** Offers per coupon id; null when they could not be read. */
  offersByCoupon: Record<string, CouponOfferRef[]> | null;
  nowIso: string;
  listError: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const planMap = useMemo(() => (plans ? new Map<string, CouponPlanRef>(plans.map((p) => [p.id, p])) : null), [plans]);

  const status = pick(params.get("status"), STATUSES, "all");
  const type = pick(params.get("type"), TYPES, "any");
  const expiry = pick(params.get("expiry"), EXPIRIES, "any");
  const search = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const openId = params.get("coupon");
  const creating = params.get("new") === "1";
  const duplicateOf = creating ? coupons.find((c) => c.id === params.get("from")) ?? null : null;
  const pageSize = useFittingPageSize(480, 45);

  const set = (patch: Record<string, string | null>) => setParamsInPlace(patch);
  const filter = (patch: Record<string, string | null>) => set({ ...patch, page: null });

  const sorted = useMemo(() => sortActiveFirst(coupons, now), [coupons, now]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sorted.filter((coupon) => {
      if (status !== "all" && statusOf(coupon, now) !== status) return false;
      if (type !== "any" && coupon.discount_type !== type) return false;
      if (!matchesExpiry(coupon, expiry, now)) return false;
      return !needle || coupon.code.toLowerCase().includes(needle);
    });
  }, [sorted, status, type, expiry, search, now]);

  const { current, rows: shown } = paginate(filtered, page, pageSize);
  const anyFilter = status !== "all" || expiry !== "any" || type !== "any" || search.trim() !== "";
  const clearAll = () => filter({ status: null, type: null, expiry: null, q: null });
  const open = openId ? coupons.find((c) => c.id === openId) ?? null : null;

  return (
    <>
      <TableCard
        className="min-w-0"
        footer={<Pager page={current} pageSize={pageSize} total={filtered.length} noun={filtered.length === 1 ? "coupon" : "coupons"} suffix="active first, then newest" onPage={(next) => set({ page: next > 1 ? String(next) : null })} />}
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch value={search} onChange={(value) => filter({ q: value || null })} placeholder="Search code" />
            <select aria-label="Status" value={status} onChange={(event) => filter({ status: event.target.value === "all" ? null : event.target.value })} className={toolbarControl}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
              <option value="expired">Expired</option>
              <option value="exhausted">Exhausted</option>
            </select>
            <select aria-label="Discount type" value={type} onChange={(event) => filter({ type: event.target.value === "any" ? null : event.target.value })} className={toolbarControl}>
              <option value="any">Any discount type</option>
              <option value="percent">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </select>
            <select aria-label="Expiry" value={expiry} onChange={(event) => filter({ expiry: event.target.value === "any" ? null : event.target.value })} className={toolbarControl}>
              <option value="any">Any expiry</option>
              <option value="soon">Active, expiring within {EXPIRING_SOON_DAYS} days</option>
              <option value="dated">Has an expiry date</option>
              <option value="none">Never expires</option>
            </select>
            {anyFilter && <Button type="button" variant="ghost" onClick={clearAll}>Clear</Button>}
          </DataToolbar>
        }
      >
        {listError ? (
          <ErrorState title="The coupons could not be read" detail="The list did not load, so it is not shown as empty. Reload the page; if it keeps failing, the error is in the server log." />
        ) : coupons.length === 0 ? (
          <EmptyState title="No coupons yet" hint="Create one to hand out a price break at Whop checkout." />
        ) : filtered.length === 0 ? (
          <NoMatches noun="coupons" onClear={clearAll} />
        ) : (
          <Table className="min-w-[1040px]">
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Restrictions</TableHead>
                <TableHead className="text-right">Redemptions</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Used by offers</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((coupon) => {
                const state = statusOf(coupon, now);
                const given = discountGiven?.[coupon.id];
                const offers = offersByCoupon?.[coupon.id] ?? [];
                const openRow = () => set({ coupon: coupon.id });
                return (
                  <TableRow key={coupon.id} className="cursor-pointer" onClick={openRow} aria-selected={openId === coupon.id}>
                    <TableCell className="font-mono font-semibold text-foreground">
                      <button type="button" className="hover:underline" onClick={(event) => { event.stopPropagation(); openRow(); }} aria-label={`Open ${coupon.code}`}>{coupon.code}</button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap" title={given === undefined ? undefined : `${formatCentsAsCurrency(given)} taken off our invoices so far (applied by staff or offers)`}>
                      {describeDiscount(coupon)}
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate" title={describeRestrictions(coupon, planMap)}>{describeRestrictions(coupon, planMap)}</TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{describeRedemptions(coupon.redeemed_count, coupon.max_redemptions)}</TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      {coupon.expires_at ? <time dateTime={coupon.expires_at} title={utcDayTime(coupon.expires_at)}>{utcDay(coupon.expires_at)}</time> : "—"}
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate" title={offers.map((o) => o.name).join(", ") || undefined}>
                      {offersByCoupon === null ? <span className="text-muted-foreground">—</span> : offers.length === 0 ? <span className="text-muted-foreground">None</span> : offers.map((o) => o.name).join(", ")}
                    </TableCell>
                    <TableCell><StatusChip tone={COUPON_CHIP[state]} dot>{COUPON_STATUS_LABEL[state]}</StatusChip></TableCell>
                    <TableCell className="text-right text-muted-foreground" aria-hidden="true">›</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>

      {open && !creating && (
        <CouponSheet
          key={open.id}
          coupon={open}
          now={now}
          planMap={planMap}
          givenCents={discountGiven === null ? undefined : discountGiven[open.id] ?? 0}
          redemptions={redemptions === null ? null : redemptions[open.id] ?? []}
          offers={offersByCoupon === null ? null : offersByCoupon[open.id] ?? []}
          onClose={() => set({ coupon: null })}
          onDuplicate={() => set({ new: "1", from: open.id })}
          onChanged={() => startRefresh(() => router.refresh())}
        />
      )}

      {creating && (
        <CouponCreateSheet
          key={duplicateOf?.id ?? "new"}
          plans={plans ? plans.filter((p) => !p.is_archived) : null}
          duplicateOf={duplicateOf}
          onClose={() => set({ new: null, from: null })}
          onCreated={() => {
            set({ new: null, from: null, coupon: null, q: null, status: null, type: null, expiry: null, page: null });
            startRefresh(() => router.refresh());
          }}
        />
      )}
    </>
  );
}

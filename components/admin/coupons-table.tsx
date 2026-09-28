"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { Pill, st } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import type { CouponRow } from "@/lib/coupons/constants";
import type { CouponStatus } from "@/lib/coupons/discount";
import {
  COUPON_STATUS_LABEL,
  COUPON_STATUS_TONE,
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
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

type StatusFilter = "all" | CouponStatus;
type TypeFilter = "any" | "percent" | "fixed";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * The coupons list (board p-adm-coupons): one TableCard with its toolbar inside and the pager at
 * its foot.
 *
 * Every coupon is on the client (tens, not thousands), so search, the filters and paging are
 * instant and the counts exact. `nowIso` comes from the server so a coupon's status is decided once
 * and the browser cannot disagree with it during hydration.
 *
 * Deactivate is the one action a row has, in the last column.
 */
export function CouponsTable({
  coupons,
  plans,
  discountGiven,
  nowIso,
  listError,
}: {
  coupons: CouponRow[];
  /** Null when the plans could not be read. */
  plans: CouponPlanRef[] | null;
  /** Cents off our invoices per coupon id; null when it could not be read. */
  discountGiven: Record<string, number> | null;
  nowIso: string;
  listError: boolean;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const planMap = useMemo(() => (plans ? new Map(plans.map((p) => [p.id, p])) : null), [plans]);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [expiry, setExpiry] = useState<ExpiryFilter>("any");
  const [type, setType] = useState<TypeFilter>("any");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<CouponRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

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

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 1), pages);
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const anyFilter = status !== "all" || expiry !== "any" || type !== "any" || search.trim() !== "";

  function clearAll() {
    setExpiry("any");
    setType("any");
    setStatus("all");
    setSearch("");
    setPage(1);
  }

  function closeDialog() {
    if (busy) return;
    setPending(null);
    setDialogError(null);
  }

  async function deactivate(coupon: CouponRow) {
    setBusy(true);
    setDialogError(null);
    const res = await fetch(`/api/admin/coupons/${coupon.id}/deactivate`, { method: "POST" }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) {
      // Kept in the dialog: the answer says whether anything changed, and that must be read.
      setDialogError(body?.error ?? "Whop could not be reached, so nothing was changed. Try again.");
      return;
    }
    notify.done(body?.message ?? `${coupon.code} deactivated`);
    setPending(null);
    router.refresh();
  }

  return (
    <>
      <TableCard
        className="min-w-0"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search code"
            />
            <select
              aria-label="Status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as StatusFilter);
                setPage(1);
              }}
              className={toolbarControl}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
              <option value="expired">Expired</option>
              <option value="exhausted">Exhausted</option>
            </select>
            <select
              aria-label="Expiry"
              value={expiry}
              onChange={(event) => {
                setExpiry(event.target.value as ExpiryFilter);
                setPage(1);
              }}
              className={toolbarControl}
            >
              <option value="any">Any expiry</option>
              <option value="soon">Active, expiring within {EXPIRING_SOON_DAYS} days</option>
              <option value="dated">Has an expiry date</option>
              <option value="none">Never expires</option>
            </select>
            <select
              aria-label="Discount type"
              value={type}
              onChange={(event) => {
                setType(event.target.value as TypeFilter);
                setPage(1);
              }}
              className={toolbarControl}
            >
              <option value="any">Any discount type</option>
              <option value="percent">Percentage</option>
              <option value="fixed">Fixed amount</option>
            </select>
            {anyFilter && (
              <Button type="button" variant="ghost" onClick={clearAll}>
                Clear
              </Button>
            )}
          </DataToolbar>
        }
      >
        <table className={cn(st.table, "min-w-[980px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={cn(st.th, "w-[150px]")}>Code</th>
              <th scope="col" className={cn(st.th, "w-[120px]")}>Discount</th>
              <th scope="col" className={st.th}>Restrictions</th>
              <th scope="col" className={cn(st.th, "w-[130px]")}>Redemptions</th>
              <th scope="col" className={cn(st.th, "w-[130px]")}>Expires</th>
              <th scope="col" className={cn(st.th, "w-[130px]")}>Status</th>
              <th scope="col" className={cn(st.th, "w-[120px] text-right")}>
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {listError && (
              <tr>
                <td colSpan={7} className="border-t border-[var(--border)] p-0">
                  <ErrorState
                    title="The coupons could not be read"
                    detail="The list did not load, so it is not shown as empty. Reload the page; if it keeps failing, the error is in the server log."
                  />
                </td>
              </tr>
            )}
            {!listError && coupons.length === 0 && (
              <tr>
                <td colSpan={7} className="border-t border-[var(--border)] p-0">
                  <EmptyState title="No coupons yet" hint="Create one to hand out a price break at Whop checkout." />
                </td>
              </tr>
            )}
            {coupons.length > 0 && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="border-t border-[var(--border)] p-0">
                  <NoMatches noun="coupons" onClear={clearAll} />
                </td>
              </tr>
            )}
            {shown.map((coupon) => {
              const state = statusOf(coupon, now);
              const given = discountGiven?.[coupon.id];
              return (
                <tr key={coupon.id} className="m-row hover:bg-[var(--brand-50)]">
                  <td className={st.td}>
                    <code className="font-mono text-[14px] font-semibold text-[var(--ink)]">{coupon.code}</code>
                  </td>
                  <td
                    className={cn(st.td, "whitespace-nowrap")}
                    title={
                      given === undefined
                        ? undefined
                        : `${USD.format(given / 100)} taken off our invoices so far (applied by staff or offers)`
                    }
                  >
                    {describeDiscount(coupon)}
                  </td>
                  <td className={st.td}>{describeRestrictions(coupon, planMap)}</td>
                  <td className={cn(st.td, "tabular-nums whitespace-nowrap")}>
                    {describeRedemptions(coupon.redeemed_count, coupon.max_redemptions)}
                  </td>
                  <td className={cn(st.td, "tabular-nums")}>
                    {coupon.expires_at ? <ExpiryDate iso={coupon.expires_at} /> : "—"}
                  </td>
                  <td className={st.td}>
                    <Pill tone={COUPON_STATUS_TONE[state]} dot>
                      {COUPON_STATUS_LABEL[state]}
                    </Pill>
                  </td>
                  <td className={cn(st.td, "text-right")}>
                    {coupon.is_active && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-[var(--error-ink)]"
                        onClick={() => {
                          setDialogError(null);
                          setPending(coupon);
                        }}
                        aria-label={`Deactivate ${coupon.code}`}
                      >
                        Deactivate
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <BoardTableFooter
          page={current}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          itemLabel={filtered.length === 1 ? "coupon" : "coupons"}
          order="active first, then newest"
          onPageChange={setPage}
        />
      </TableCard>

      <Dialog open={pending !== null} onOpenChange={(value) => !value && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {pending?.code}</DialogTitle>
            <DialogDescription>
              {pending?.whop_promo_code_id
                ? "Whop is asked to switch the promo code off first, so it can no longer be entered at checkout. Only when Whop confirms is it marked deactivated here; if Whop refuses or does not answer, nothing changes."
                : "This coupon has no Whop promo code on record, so only this record changes."}{" "}
              Subscriptions already carrying it keep their discount until it runs out. The coupon stays on this list.
            </DialogDescription>
          </DialogHeader>
          {dialogError && (
            <p role="alert" className="m-0 text-[14px] leading-[1.5] text-[var(--error-ink)]">
              {dialogError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => pending && void deactivate(pending)} disabled={busy}>
              {busy ? "Deactivating…" : "Deactivate coupon"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The expiry day in UTC, with the exact moment in UTC and in the reader's own time on hover. */
function ExpiryDate({ iso }: { iso: string }) {
  const ref = useRef<HTMLTimeElement>(null);
  const full = utcDayTime(iso);
  useEffect(() => {
    const date = new Date(iso);
    if (ref.current && !Number.isNaN(date.getTime())) {
      ref.current.title = `${full} · ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })} your time`;
    }
  }, [iso, full]);
  return (
    <time ref={ref} dateTime={iso} title={full} className="whitespace-nowrap">
      {utcDay(iso)}
    </time>
  );
}

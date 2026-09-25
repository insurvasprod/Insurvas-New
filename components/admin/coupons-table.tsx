"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { Pill, SearchBox, btn, st } from "@/components/app/settings/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/page-states";
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

const OUTLINE =
  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

type StatusFilter = "all" | CouponStatus;
type TypeFilter = "any" | "percent" | "fixed";

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/**
 * The coupons list (board p-adm-coupons): the toolbar card, then the table card with its footer.
 *
 * Every coupon is on the client (tens, not thousands), so the status filter, search, the Filters
 * panel and paging are instant and the counts exact. `nowIso` comes from the server so a coupon's
 * status is decided once and the browser cannot disagree with it during hydration.
 *
 * Deactivate is the one action a row has. The board draws no action column; it is added at the end
 * because the board's callout tells staff to "deactivate instead", and they need somewhere to do it.
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
  const id = useId();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const planMap = useMemo(() => (plans ? new Map(plans.map((p) => [p.id, p])) : null), [plans]);

  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [expiry, setExpiry] = useState<ExpiryFilter>("any");
  const [type, setType] = useState<TypeFilter>("any");
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const panelFilters = (expiry === "any" ? 0 : 1) + (type === "any" ? 0 : 1);

  function clearPanel() {
    setExpiry("any");
    setType("any");
    setPage(1);
  }

  function clearAll() {
    clearPanel();
    setStatus("all");
    setSearch("");
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
      <div className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="relative inline-flex">
            <select
              aria-label="Status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as StatusFilter);
                setPage(1);
              }}
              className={cn(OUTLINE, "appearance-none pr-9")}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
              <option value="expired">Expired</option>
              <option value="exhausted">Exhausted</option>
            </select>
            <Chevron className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-[var(--ink)]" />
          </span>
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search code"
            label="Search code"
          />
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={`${id}-filters`}
            onClick={() => setFiltersOpen((value) => !value)}
            className={OUTLINE}
          >
            <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M3 5h18M6 12h12M10 19h4" />
            </svg>
            Filters
            {panelFilters > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)] tabular-nums">
                {panelFilters}
              </span>
            )}
          </button>
          <span className="grow" />
        </div>

        {filtersOpen && (
          <div id={`${id}-filters`} className="flex flex-wrap items-end gap-4 border-t border-[var(--border)] pt-3">
            <FilterSelect
              id={`${id}-expiry`}
              label="Expiry"
              value={expiry}
              onChange={(value) => {
                setExpiry(value as ExpiryFilter);
                setPage(1);
              }}
              options={[
                { value: "any", label: "Any" },
                { value: "soon", label: `Active, expiring within ${EXPIRING_SOON_DAYS} days` },
                { value: "dated", label: "Has an expiry date" },
                { value: "none", label: "Never expires" },
              ]}
            />
            <FilterSelect
              id={`${id}-type`}
              label="Discount type"
              value={type}
              onChange={(value) => {
                setType(value as TypeFilter);
                setPage(1);
              }}
              options={[
                { value: "any", label: "Any" },
                { value: "percent", label: "Percentage" },
                { value: "fixed", label: "Fixed amount" },
              ]}
            />
            {panelFilters > 0 && (
              <button type="button" className={btn("row")} onClick={clearPanel}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <section
        aria-label="Coupons"
        className="flex min-w-0 grow flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]"
      >
        <div className="min-w-0 overflow-x-auto">
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
                    <EmptyState
                      title="No coupons yet"
                      hint="A coupon is a Whop promo code, so the customer is actually charged less rather than being told they were. Create one to hand out a price break."
                    />
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
                        <button
                          type="button"
                          className={btn("danger-row")}
                          onClick={() => {
                            setDialogError(null);
                            setPending(coupon);
                          }}
                          aria-label={`Deactivate ${coupon.code}`}
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grow" />
        <BoardTableFooter
          page={current}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          itemLabel={filtered.length === 1 ? "coupon" : "coupons"}
          order="active first, then newest"
          onPageChange={setPage}
        />
      </section>

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
            <button type="button" className={btn("ghost")} onClick={closeDialog} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className={btn("primary", "bg-[var(--error)] hover:bg-[var(--error-ink)]")}
              onClick={() => pending && void deactivate(pending)}
              disabled={busy}
            >
              {busy ? "Deactivating…" : "Deactivate coupon"}
            </button>
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

function Chevron({ className }: { className?: string }) {
  return (
    <svg aria-hidden width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <span className="flex min-w-[200px] flex-col gap-1">
      <label htmlFor={id} className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] tracking-[-0.02em] text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

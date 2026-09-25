"use client";

import { useMemo, useState } from "react";
import { ChevronDown, MoreHorizontal, Search } from "lucide-react";
import { notify } from "@/lib/notify";

import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { StatusChip, type StatusTone } from "@/components/admin/status-chip";
import { fullDate } from "@/components/admin/tenant-record/billing-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { formatCentsAsCurrency } from "@/lib/money";
import { PLAN_TYPES, PLAN_TYPE_LABELS, BILLING_CYCLE_LABELS, OFFER_DURATION_LABELS, type OfferRow, type PlanType, type BillingCycle, type DiscountType, type CouponDuration } from "@/lib/offers/constants";
import type { PlanListRow } from "@/lib/plans/constants";
import type { SubscriptionRow } from "@/lib/subscriptions/queries";
import { cn } from "@/lib/utils";

type FormState = {
  name: string;
  discount_type: DiscountType;
  percent_off: string;
  amount_off: string;
  duration: CouponDuration;
  duration_periods: string;
  starts_at: string;
  ends_at: string;
  max_redemptions: string;
  auto_apply: boolean;
  eligible_plan_types: PlanType[];
  eligible_plan_ids: string[];
  new_customers_only: boolean;
  existing_customers_only: boolean;
  eligible_cycles: BillingCycle[];
};

const emptyForm: FormState = {
  name: "",
  discount_type: "percent",
  percent_off: "50",
  amount_off: "",
  duration: "n_periods",
  duration_periods: "3",
  starts_at: "",
  ends_at: "",
  max_redemptions: "",
  auto_apply: false,
  eligible_plan_types: [],
  eligible_plan_ids: [],
  new_customers_only: false,
  existing_customers_only: false,
  eligible_cycles: [],
};

function inputDate(value: string | null): string {
  return value ? value.slice(0, 16) : "";
}

function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function formFromOffer(offer: OfferRow): FormState {
  return {
    ...emptyForm,
    name: offer.name,
    discount_type: offer.coupon?.discount_type ?? "percent",
    percent_off: String(offer.coupon?.percent_off ?? 50),
    amount_off: offer.coupon?.amount_off_cents ? String(offer.coupon.amount_off_cents / 100) : "",
    duration: offer.coupon?.duration ?? "n_periods",
    duration_periods: String(offer.coupon?.duration_periods ?? 3),
    starts_at: inputDate(offer.starts_at),
    ends_at: inputDate(offer.ends_at),
    max_redemptions: offer.max_redemptions === null ? "" : String(offer.max_redemptions),
    auto_apply: offer.auto_apply,
    eligible_plan_types: offer.eligible_plan_types,
    eligible_plan_ids: offer.eligible_plan_ids,
    new_customers_only: offer.new_customers_only,
    existing_customers_only: offer.existing_customers_only,
    eligible_cycles: offer.eligible_cycles,
  };
}

type OfferState = "active" | "scheduled" | "ended" | "inactive";
const STATE: Record<OfferState, { label: string; tone: StatusTone }> = {
  active: { label: "Active", tone: "good" },
  scheduled: { label: "Scheduled", tone: "info" },
  ended: { label: "Ended", tone: "neutral" },
  inactive: { label: "Deactivated", tone: "neutral" },
};

/** Active and scheduled are the two states an operator most needs to tell apart — only the clock separates them. */
function stateOf(offer: OfferRow, now: number): OfferState {
  if (offer.ends_at && Date.parse(offer.ends_at) < now) return "ended";
  if (!offer.is_active) return "inactive";
  if (offer.starts_at && Date.parse(offer.starts_at) > now) return "scheduled";
  return "active";
}

/** "20% off for 3 billing periods". */
function ruleOf(offer: OfferRow): string {
  const c = offer.coupon;
  if (!c) return "Coupon unavailable";
  const amount = c.discount_type === "percent" ? `${c.percent_off ?? 0}% off` : `${formatCentsAsCurrency(c.amount_off_cents ?? 0)} off`;
  const how = c.duration === "once" ? "for one billing period" : c.duration === "forever" ? "forever" : `for ${c.duration_periods ?? 0} billing ${c.duration_periods === 1 ? "period" : "periods"}`;
  return `${amount} ${how}`;
}

/** Could two offers apply to the same subscription at the same time? Empty lists mean "all". */
function overlaps(a: OfferRow, b: OfferRow): boolean {
  const start = (o: OfferRow) => (o.starts_at ? Date.parse(o.starts_at) : -Infinity);
  const end = (o: OfferRow) => (o.ends_at ? Date.parse(o.ends_at) : Infinity);
  if (start(a) > end(b) || start(b) > end(a)) return false;
  const meet = <T,>(x: readonly T[], y: readonly T[]) => x.length === 0 || y.length === 0 || x.some((item) => y.includes(item));
  if (!meet(a.eligible_plan_ids, b.eligible_plan_ids) || !meet(a.eligible_plan_types, b.eligible_plan_types) || !meet(a.eligible_cycles, b.eligible_cycles)) return false;
  if ((a.new_customers_only && b.existing_customers_only) || (a.existing_customers_only && b.new_customers_only)) return false;
  return true;
}

const PAGE = 25;
const control = "h-10 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const th = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";
const primary44 = "inline-flex h-11 items-center justify-center rounded-[8px] border border-transparent bg-[var(--primary)] px-4 text-[14px] font-semibold text-[var(--on-primary)] hover:bg-[var(--accent-hover)]";

/**
 * The offers board (p-adm-offers): the campaign layer over coupons. Figures, filters and table all
 * read the same offers, resolved against one render time (`now`, passed in so server and browser
 * agree on which offers have started).
 */
export function OffersTable({
  initialOffers,
  plans,
  subscriptions,
  now,
}: {
  initialOffers: OfferRow[];
  plans: PlanListRow[];
  subscriptions: SubscriptionRow[];
  now: number;
}) {
  const [offers, setOffers] = useState(initialOffers);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<OfferRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [applyOffer, setApplyOffer] = useState<OfferRow | null>(null);
  const [subscriptionId, setSubscriptionId] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<"" | OfferState>("");
  const [page, setPage] = useState(1);

  const planName = useMemo(() => new Map(plans.map((p) => [p.id, p.name])), [plans]);
  const withState = useMemo(() => offers.map((offer) => ({ offer, state: stateOf(offer, now) })), [offers, now]);
  const live = withState.filter((row) => row.state === "active" || row.state === "scheduled").map((row) => row.offer);
  const overlapping = live.map((offer) => ({ offer, with: live.filter((other) => other.id !== offer.id && overlaps(offer, other)) })).filter((row) => row.with.length > 0);
  const count = (state: OfferState) => withState.filter((row) => row.state === state);
  const redemptions = (rows: Array<{ offer: OfferRow }>) => rows.reduce((sum, row) => sum + row.offer.redeemed_count, 0);
  const nextStart = count("scheduled").map((row) => row.offer.starts_at).filter(Boolean).sort()[0] ?? null;

  function targetOf(offer: OfferRow): string {
    const parts: string[] = [];
    if (offer.eligible_plan_ids.length) parts.push(`Plan · ${offer.eligible_plan_ids.map((id) => planName.get(id) ?? "Removed plan").join(", ")}`);
    else if (offer.eligible_plan_types.length) parts.push(`Plan type · ${offer.eligible_plan_types.map((t) => PLAN_TYPE_LABELS[t]).join(", ")}`);
    else parts.push("Every plan");
    if (offer.new_customers_only) parts.push("new signups");
    if (offer.existing_customers_only) parts.push("existing customers");
    if (offer.eligible_cycles.length) parts.push(offer.eligible_cycles.map((c) => BILLING_CYCLE_LABELS[c].toLowerCase()).join(" / "));
    return parts.join(" · ");
  }

  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () => withState
      .filter(({ offer, state }) =>
        (!stateFilter || state === stateFilter)
        && (!target || (target === "all" ? offer.eligible_plan_ids.length === 0 : offer.eligible_plan_ids.length === 0 || offer.eligible_plan_ids.includes(target)))
        && (!needle || offer.name.toLowerCase().includes(needle) || (offer.coupon?.code ?? "").toLowerCase().includes(needle)))
      .sort((a, b) => Date.parse(b.offer.starts_at ?? b.offer.created_at) - Date.parse(a.offer.starts_at ?? a.offer.created_at)),
    [withState, stateFilter, target, needle],
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);
  const anyFilter = Boolean(needle || target || stateFilter);
  function clear() { setQuery(""); setTarget(""); setStateFilter(""); setPage(1); }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleArray(
    key: "eligible_plan_types" | "eligible_plan_ids" | "eligible_cycles",
    value: PlanType | BillingCycle | string,
  ) {
    setForm((current) => {
      const values = current[key] as readonly string[];
      const next = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
      return { ...current, [key]: next } as FormState;
    });
  }

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(offer: OfferRow) {
    setEditing(offer);
    setForm(formFromOffer(offer));
    setFormOpen(true);
  }

  function payload() {
    return {
      name: form.name,
      ...(editing ? {} : {
        discount_type: form.discount_type,
        percent_off: form.discount_type === "percent" ? Number(form.percent_off) : null,
        amount_off: form.discount_type === "fixed" ? form.amount_off : null,
        duration: form.duration,
        duration_periods: form.duration === "n_periods" ? Number(form.duration_periods) : null,
      }),
      starts_at: toIso(form.starts_at),
      ends_at: toIso(form.ends_at),
      max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
      auto_apply: form.auto_apply,
      eligible_plan_types: form.eligible_plan_types,
      eligible_plan_ids: form.eligible_plan_ids,
      new_customers_only: form.new_customers_only,
      existing_customers_only: form.existing_customers_only,
      eligible_cycles: form.eligible_cycles,
    };
  }

  async function save() {
    if (!form.name.trim()) {
      notify.block("Give the offer a name");
      return;
    }
    setBusy(true);
    const response = await fetch(editing ? `/api/admin/offers/${editing.id}` : "/api/admin/offers", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      notify.block(body?.error ?? "Could not save offer");
      return;
    }
    const saved = body.offer as OfferRow;
    setOffers((current) => editing ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]);
    setFormOpen(false);
    notify.done(editing ? "Offer updated" : "Offer created");
  }

  async function apply() {
    if (!applyOffer || !subscriptionId) {
      notify.block("Choose a customer");
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/admin/offers/${applyOffer.id}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription_id: subscriptionId, confirmed }),
    });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      if (body?.code === "confirmation_required") {
        setWarning(body.warning);
        return;
      }
      notify.block(body?.error ?? "Could not apply offer");
      return;
    }
    notify.done("Offer applied");
    setApplyOffer(null);
    setSubscriptionId("");
    setWarning(null);
    setConfirmed(false);
  }

  async function toggleActive(offer: OfferRow) {
    setBusy(true);
    const response = await fetch(`/api/admin/offers/${offer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !offer.is_active }),
    });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      notify.block(body?.error ?? "Could not update offer");
      return;
    }
    setOffers((current) => current.map((item) => item.id === offer.id ? { ...item, is_active: !offer.is_active } : item));
    notify.done(offer.is_active ? "Offer deactivated" : "Offer reactivated");
  }

  const firstOverlap = overlapping[0];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Offers & discounts"
        description="The campaign layer over coupons: promotions and automatic discount rules."
        actions={<button type="button" className={primary44} onClick={openNew}>New offer</button>}
      />

      <BoardStatGrid>
        <BoardStatTile label="Active" value={count("active").length.toLocaleString()} footnote={`${redemptions(count("active")).toLocaleString()} redemptions`} />
        <BoardStatTile label="Scheduled" value={count("scheduled").length.toLocaleString()} footnote={nextStart ? `next starts ${fullDate(nextStart)}` : "nothing scheduled"} />
        <BoardStatTile label="Ended" value={count("ended").length.toLocaleString()} footnote={`${redemptions(count("ended")).toLocaleString()} redemptions`} />
        <BoardStatTile
          label="Overlapping offers"
          value={overlapping.length.toLocaleString()}
          tone={overlapping.length > 0 ? "warning" : "default"}
          footnote={firstOverlap ? `${firstOverlap.offer.name} with ${firstOverlap.with[0].name}${firstOverlap.with.length > 1 ? ` +${firstOverlap.with.length - 1}` : ""}` : "no two could apply at once"}
          title="Active or scheduled offers whose windows, plans, cycles and customer rules overlap, so both could apply to the same subscription."
        />
      </BoardStatGrid>

      <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <span className="relative inline-flex">
          <select aria-label="Target" value={target} onChange={(event) => { setTarget(event.target.value); setPage(1); }} className={cn(control, "appearance-none pr-9")}>
            <option value="">All targets</option>
            <option value="all">Every plan (no plan restriction)</option>
            {plans.filter((p) => !p.is_archived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
        </span>
        <span className="flex h-10 w-full items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[var(--muted)] sm:w-[248px]">
          <Search className="size-4 shrink-0" aria-hidden />
          <input type="search" aria-label="Search offer or coupon" placeholder="Search offer or coupon" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} className="min-w-0 flex-grow border-0 bg-transparent text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]" />
        </span>
        <span role="group" aria-label="Status" className="inline-flex flex-wrap gap-[3px] rounded-[8px] bg-[var(--surface-alt)] p-[3px]">
          {([["", "All"], ["active", "Active"], ["scheduled", "Scheduled"], ["ended", "Ended"], ["inactive", "Deactivated"]] as const).map(([value, label]) => (
            <button key={value || "all"} type="button" aria-pressed={stateFilter === value} onClick={() => { setStateFilter(value); setPage(1); }} className={cn("h-8 rounded-[6px] border px-3 text-[14px] font-semibold", stateFilter === value ? "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]" : "border-transparent text-[var(--muted)]")}>{label}</button>
          ))}
        </span>
        <span className="flex-grow" />
        {anyFilter && <button type="button" onClick={clear} className="text-[14px] font-semibold text-[var(--ink)] hover:underline">Clear</button>}
      </div>

      <div className="relative min-w-0 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr className="bg-[var(--surface-alt)]">
                <th scope="col" className={th}>Offer</th>
                <th scope="col" className={cn(th, "w-[230px]")}>Rule</th>
                <th scope="col" className={cn(th, "w-[220px]")}>Target</th>
                <th scope="col" className={cn(th, "w-[200px]")}>Window</th>
                <th scope="col" className={cn(th, "w-[140px] text-right")}>Redemptions</th>
                <th scope="col" className={cn(th, "w-[130px]")}>Status</th>
                <th scope="col" className={cn(th, "w-[56px]")}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={7} className="p-0">
                  {anyFilter ? <NoMatches noun="offers" onClear={clear} /> : <EmptyState title="No offers yet" hint="An offer applies a discount to whoever qualifies, without touching each customer." />}
                </td></tr>
              ) : shown.map(({ offer, state }) => {
                const clash = overlapping.find((row) => row.offer.id === offer.id);
                return (
                  <tr key={offer.id} className={cn("align-top hover:bg-[color-mix(in_srgb,var(--primary),transparent_95%)]", (state === "ended" || state === "inactive") && "opacity-70")}>
                    <td className={td}>
                      <span className="font-semibold text-[var(--ink)]">{offer.name}</span>
                      <span className="block text-[12px] text-[var(--muted)]">{offer.coupon ? <code className="font-mono">{offer.coupon.code}</code> : "No coupon"} · {offer.auto_apply ? "applied automatically" : "manual only"}</span>
                      {clash && <span className="mt-0.5 block text-[12px] font-semibold text-[var(--warning-ink)]">Overlaps {clash.with.map((o) => o.name).join(", ")}</span>}
                    </td>
                    <td className={td}>{ruleOf(offer)}</td>
                    <td className={td}>{targetOf(offer)}</td>
                    <td className={cn(td, "whitespace-nowrap tabular-nums")}>{offer.starts_at ? fullDate(offer.starts_at) : "Now"} – {offer.ends_at ? fullDate(offer.ends_at) : "no end"}</td>
                    <td className={cn(td, "text-right tabular-nums")}>
                      {offer.redeemed_count.toLocaleString()}{offer.max_redemptions === null ? "" : ` / ${offer.max_redemptions.toLocaleString()}`}
                      <span className="block text-[12px] text-[var(--muted)]">{formatCentsAsCurrency(offer.discount_given_cents)} given</span>
                    </td>
                    <td className={td}><StatusChip tone={STATE[state].tone} dot>{STATE[state].label}</StatusChip></td>
                    <td className={cn(td, "text-right")}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" aria-label={`Actions for ${offer.name}`} disabled={busy} className="inline-flex size-8 items-center justify-center rounded-[8px] text-[var(--muted)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)] disabled:opacity-50">
                            <MoreHorizontal className="size-4" aria-hidden />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEdit(offer)}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => { setApplyOffer(offer); setSubscriptionId(""); setWarning(null); setConfirmed(false); }}>Apply to a customer</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {offer.is_active
                            ? <DropdownMenuItem variant="destructive" onSelect={() => void toggleActive(offer)}>Deactivate</DropdownMenuItem>
                            : <DropdownMenuItem onSelect={() => void toggleActive(offer)}>Reactivate</DropdownMenuItem>}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && <BoardTableFooter page={current} pageSize={PAGE} total={rows.length} itemLabel={rows.length === 1 ? "offer" : "offers"} order="latest start first" onPageChange={setPage} />}
      </div>

      {firstOverlap && (
        <div className="rounded-[12px] border border-[var(--border)] border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5">
          <p className="text-[14px] font-semibold text-[var(--warning-ink)]">{overlapping.length === 1 ? "One offer overlaps another" : `${overlapping.length} offers overlap another`}</p>
          <p className="mt-1.5 text-[14px] leading-normal text-[var(--body)]">{firstOverlap.offer.name} and {firstOverlap.with[0].name} could both apply to the same subscription in the same window. Narrow a window, a plan or a customer rule if they are not meant to combine. A cancelled subscription is never offered in Apply.</p>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Edit offer" : "New offer"}</DialogTitle><DialogDescription>{editing ? "Update the campaign rules and window. Discount terms stay fixed after creation so existing applications remain truthful." : "Create a campaign on top of the existing coupon arithmetic."}</DialogDescription></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2"><Label htmlFor="offer-name">Name</Label><Input id="offer-name" value={form.name} onChange={(event) => set("name", event.target.value)} /></div>
            {!editing && <>
              <div className="space-y-2"><Label htmlFor="offer-discount-type">Discount</Label><select id="offer-discount-type" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={form.discount_type} onChange={(event) => set("discount_type", event.target.value as DiscountType)}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></div>
              <div className="space-y-2"><Label htmlFor="offer-discount-value">{form.discount_type === "percent" ? "Percent off" : "Amount off"}</Label><Input id="offer-discount-value" inputMode="decimal" value={form.discount_type === "percent" ? form.percent_off : form.amount_off} onChange={(event) => set(form.discount_type === "percent" ? "percent_off" : "amount_off", event.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="offer-duration">Duration</Label><select id="offer-duration" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={form.duration} onChange={(event) => set("duration", event.target.value as CouponDuration)}>{Object.entries(OFFER_DURATION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
              {form.duration === "n_periods" && <div className="space-y-2"><Label htmlFor="offer-duration-periods">Number of billing periods</Label><Input id="offer-duration-periods" type="number" min={1} max={60} value={form.duration_periods} onChange={(event) => set("duration_periods", event.target.value)} /></div>}
            </>}
            <div className="space-y-2"><Label htmlFor="offer-starts">Starts at</Label><Input id="offer-starts" type="datetime-local" value={form.starts_at} onChange={(event) => set("starts_at", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="offer-ends">Ends at</Label><Input id="offer-ends" type="datetime-local" value={form.ends_at} onChange={(event) => set("ends_at", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="offer-cap">Maximum redemptions</Label><Input id="offer-cap" type="number" min={1} value={form.max_redemptions} onChange={(event) => set("max_redemptions", event.target.value)} placeholder="Unlimited" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.auto_apply} onChange={(event) => set("auto_apply", event.target.checked)} /> Auto-apply to qualifying assignments</label>
            <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Plan types (empty means all)</legend><div className="grid gap-2 sm:grid-cols-2">{PLAN_TYPES.map((type) => <label key={type} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.eligible_plan_types.includes(type)} onChange={() => toggleArray("eligible_plan_types", type)} /> {PLAN_TYPE_LABELS[type]}</label>)}</div></fieldset>
            <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Specific plans (empty means all)</legend><div className="grid max-h-32 gap-2 overflow-y-auto sm:grid-cols-2">{plans.map((plan) => <label key={plan.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.eligible_plan_ids.includes(plan.id)} onChange={() => toggleArray("eligible_plan_ids", plan.id)} /> {plan.name} <span className="text-xs text-muted-foreground">({plan.code})</span></label>)}</div></fieldset>
            <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Billing cycles (empty means all)</legend><div className="flex flex-wrap gap-4">{(Object.keys(BILLING_CYCLE_LABELS) as BillingCycle[]).map((cycle) => <label key={cycle} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.eligible_cycles.includes(cycle)} onChange={() => toggleArray("eligible_cycles", cycle)} /> {BILLING_CYCLE_LABELS[cycle]}</label>)}</div></fieldset>
            <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm font-medium">Customer eligibility</legend><div className="flex flex-wrap gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.new_customers_only} onChange={(event) => { set("new_customers_only", event.target.checked); if (event.target.checked) set("existing_customers_only", false); }} /> New signups only</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.existing_customers_only} onChange={(event) => { set("existing_customers_only", event.target.checked); if (event.target.checked) set("new_customers_only", false); }} /> Existing customers only</label></div></fieldset>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create offer"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(applyOffer)} onOpenChange={(open) => { if (!open) setApplyOffer(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apply {applyOffer?.name}</DialogTitle><DialogDescription>Choose a named customer subscription. Manual application bypasses campaign rules, but a plan-type mismatch always requires confirmation.</DialogDescription></DialogHeader>
          {/* User decision (25 Sep): applying to an existing subscription stays allowed, with the gap said
              plainly. Whop cannot attach a promo code to an existing membership through its API, so only
              our invoice changes — and the two then disagree, which the Invoices page reports as Mismatched. */}
          <div role="note" className="rounded-[8px] border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-3 py-2.5 text-[14px] leading-normal text-[var(--body)]">
            <strong className="font-semibold text-[var(--warning-ink)]">Our invoice gets the discount; Whop&rsquo;s charge does not change by itself.</strong>{" "}
            The customer is still charged full price unless the same code{applyOffer?.coupon?.code ? <> (<code className="font-mono">{applyOffer.coupon.code}</code>)</> : null} is applied to their membership in Whop&rsquo;s dashboard. Until then this invoice will show as Mismatched.
          </div>
          <div className="space-y-4"><div className="space-y-2"><Label htmlFor="offer-customer">Customer subscription</Label><select id="offer-customer" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={subscriptionId} onChange={(event) => { setSubscriptionId(event.target.value); setWarning(null); setConfirmed(false); }}><option value="">Choose a customer</option>{subscriptions.map((subscription) => <option key={subscription.id} value={subscription.id}>{subscription.tenant_name ?? "Unnamed customer"} · {subscription.plan_name ?? "Plan"} · {subscription.billing_cycle}</option>)}</select></div>{warning && <Card className="border-[var(--color-warning)]/50"><CardContent className="space-y-2"><p className="text-sm font-medium text-[var(--color-warning)]">Confirmation required</p><p className="text-sm">{warning}</p><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I understand and want to apply it anyway.</label></CardContent></Card>}</div>
          <DialogFooter><Button variant="outline" onClick={() => setApplyOffer(null)}>Cancel</Button><Button onClick={apply} disabled={busy || !subscriptionId || Boolean(warning && !confirmed)}>{busy ? "Applying…" : "Apply offer"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

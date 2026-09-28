"use client";

import { Fragment, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Callout, KeyValues, Pill, st, type PillTone } from "@/components/app/settings/primitives";
import {
  AssignDialog,
  CancelDialog,
  ChangePlanDialog,
  type AssignablePlan,
} from "@/components/admin/subscription-panel";
import {
  SUBSCRIPTION_STATUS_LABELS,
  accessLevelForStatus,
  availableActions,
  type SubscriptionStatus,
} from "@/lib/subscriptions/access";
import { formatCentsAsCurrency } from "@/lib/money";
import type { SubscriptionRow } from "@/lib/subscriptions/queries";
import type { VersionPinning } from "@/lib/subscriptions/tenantBilling";
import { countsTowardMrr, fullDate, listOf, priceCopy } from "./billing-format";

export type SubscriptionCardsProps = {
  tenantId: string;
  subscription: SubscriptionRow | null;
  /** Latest sellable version of every plan — what Assign and Change plan offer. */
  plans: AssignablePlan[];
  /** The tenant's own plan price on its cycle, read from ITS version (which may not be the latest). */
  currentPriceCents: number | null;
  seatLimits: Record<string, number | null>;
  seatsHeld: number;
  mrrCents: number | null;
  /** Null when this role may not see payment details. */
  billing: { methodLabel: string | null; collection: "automatic" | "manual" } | null;
  pinning: VersionPinning | null;
  /** Null when this role may not manage coupons. */
  coupons: { options: { id: string; label: string }[]; active: { code: string; summary: string } | null } | null;
  canManage: boolean;
};

const STATUS_TONE: Record<SubscriptionStatus, PillTone> = {
  trialing: "info",
  active: "success",
  past_due: "warning",
  suspended: "error",
  paused: "neutral",
  cancelling: "warning",
  cancelled: "neutral",
};

const ACCESS_NOTE = {
  read_only:
    "Read-only: they can still open their book of business, but cannot dial, import or sell.",
  none: "No access.",
} as const;

/** The board's card: 24px padding, an h2, and blocks 20px apart. */
function BoardCard({ title, sub, action, children }: { title: string; sub?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">{title}</h2>
          {sub && <p className="mt-1 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const Sub = ({ children }: { children: ReactNode }) => (
  <span className="mt-0.5 block text-[12px] leading-[1.5] font-normal tracking-[-0.01em] text-[var(--muted)]">{children}</span>
);

export function SubscriptionCards(props: SubscriptionCardsProps) {
  const { tenantId, subscription, plans, canManage } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<
    null | "assign" | "change" | "seats" | "cancel" | "trial-extend" | "trial-convert" | "trial-end" | "coupon-apply" | "coupon-remove"
  >(null);
  const close = () => setDialog(null);

  /** Every subscription route requires an Idempotency-Key; the trial and coupon routes ignore it. */
  async function send(url: string, method: "POST" | "DELETE", body: unknown, success: string): Promise<boolean> {
    setBusy(true);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      notify.block(payload?.error ?? "Something went wrong");
      return false;
    }
    const warning = payload?.proration?.warning;
    if (warning) notify.warn(`${success}. ${warning}`);
    else notify.done(success);
    close();
    router.refresh();
    return true;
  }

  const pinningCard = <VersionPinningCard pinning={props.pinning} periodEnd={subscription?.current_period_end ?? null} />;

  if (!subscription) {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <BoardCard title="Current subscription">
          <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
            Nothing sold to this tenant yet — no plan, no allowances, no seat limit.
          </p>
          {canManage && (
            <div className="flex gap-2.5">
              <Button type="button" onClick={() => setDialog("assign")}>
                Assign a plan
              </Button>
            </div>
          )}
        </BoardCard>
        {pinningCard}
        {canManage && (
          <AssignDialog
            open={dialog === "assign"}
            onClose={close}
            plans={plans}
            busy={busy}
            onAssign={(planId, cycle) =>
              void send("/api/admin/subscriptions", "POST", { tenant_id: tenantId, plan_id: planId, billing_cycle: cycle }, "Plan assigned")
            }
          />
        )}
      </div>
    );
  }

  const status = subscription.status;
  const actions = availableActions(status);
  const access = accessLevelForStatus(status);
  const maxSeats = props.seatLimits[subscription.plan_id];
  const endsRatherThanRenews = subscription.cancel_at_period_end || status === "cancelling";
  const subUrl = `/api/admin/subscriptions/${subscription.id}`;

  const items: { label: ReactNode; value: ReactNode; tone?: "warning" | "error" }[] = [
    { label: "Plan", value: `${subscription.plan_name ?? "Unknown plan"} v${subscription.plan_version ?? "?"}` },
    { label: "Price", value: priceCopy(props.currentPriceCents, subscription.billing_cycle) },
    {
      label: "Seats",
      value: maxSeats === undefined || maxSeats === null ? `${props.seatsHeld} · no limit` : `${props.seatsHeld} of ${maxSeats}`,
      tone: typeof maxSeats === "number" && props.seatsHeld >= maxSeats ? "warning" : undefined,
    },
    {
      label: "MRR",
      value: countsTowardMrr(status) ? (
        formatCentsAsCurrency(props.mrrCents ?? 0)
      ) : (
        <>
          {formatCentsAsCurrency(0)}
          <Sub>{status === "trialing" ? "On trial — not revenue yet" : "Not being charged"}</Sub>
        </>
      ),
    },
    { label: "Started", value: fullDate(subscription.started_at) },
    {
      label: endsRatherThanRenews ? "Ends" : status === "paused" ? "Period ends" : "Renews",
      value: fullDate(subscription.current_period_end),
    },
  ];
  if (status === "trialing" && subscription.trial_ends_at) {
    items.push({ label: "Trial ends", value: fullDate(subscription.trial_ends_at) });
  }
  if (props.billing) {
    items.push(
      {
        label: "Billing",
        value: props.billing.methodLabel ? (
          props.billing.methodLabel
        ) : (
          "Not recorded"
        ),
      },
      { label: "Collection", value: props.billing.collection === "manual" ? "Manual — invoiced" : "Automatic" },
    );
  }
  if (props.coupons?.active) {
    items.push({ label: "Coupon", value: <>{props.coupons.active.code}<Sub>{props.coupons.active.summary}</Sub></> });
  }

  const trialing = status === "trialing";
  const canCoupon = props.coupons !== null;
  const menu = [
    actions.canPause && { key: "pause", label: "Pause", run: () => void send(subUrl, "POST", { action: "pause", reason: "Paused by administrator" }, "Subscription paused") },
    actions.canResume && { key: "resume", label: "Resume", run: () => void send(subUrl, "POST", { action: "resume" }, "Subscription resumed") },
    actions.canCancel && !subscription.cancel_at_period_end && { key: "cancel", label: "Cancel subscription…", danger: true, run: () => setDialog("cancel") },
    trialing && { key: "trial-extend", label: "Extend trial…", run: () => setDialog("trial-extend"), group: "trial" },
    trialing && { key: "trial-convert", label: "Convert to paid now…", run: () => setDialog("trial-convert"), group: "trial" },
    trialing && { key: "trial-end", label: "End trial…", danger: true, run: () => setDialog("trial-end"), group: "trial" },
    canCoupon && !props.coupons?.active && { key: "coupon-apply", label: "Apply coupon…", run: () => setDialog("coupon-apply"), group: "coupon" },
    canCoupon && props.coupons?.active && { key: "coupon-remove", label: "Remove coupon…", danger: true, run: () => setDialog("coupon-remove"), group: "coupon" },
  ].filter(Boolean) as { key: string; label: string; run: () => void; danger?: boolean; group?: string }[];

  const changeDialogCommon = {
    onClose: close,
    plans: plans.filter((p) => p.id !== subscription.plan_id),
    cycle: subscription.billing_cycle,
    currentPrice: props.currentPriceCents,
    periodEnd: subscription.current_period_end,
    busy,
    seatLimits: props.seatLimits,
    onChange: (planId: string, applyNow: boolean) =>
      void send(subUrl, "POST", { action: "change_plan", plan_id: planId, apply_now: applyNow }, applyNow ? "Plan changed" : "Plan change queued for period end"),
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <BoardCard title="Current subscription" action={<Pill tone={STATUS_TONE[status]} dot>{SUBSCRIPTION_STATUS_LABELS[status]}</Pill>}>
        {access !== "full" && <Callout tone="warning" title={ACCESS_NOTE[access]} />}
        <KeyValues items={items} />
        {subscription.pending_plan_name && (
          <Callout
            tone="warning"
            title={`Queued change to ${subscription.pending_plan_name}, takes effect ${subscription.current_period_end ? fullDate(subscription.current_period_end) : "at period end"}`}
          />
        )}
        {subscription.cancel_at_period_end && (
          <Callout tone="error" title={`Cancelling — ends ${subscription.current_period_end ? fullDate(subscription.current_period_end) : "at period end"}`}>
            {subscription.cancel_reason ?? undefined}
          </Callout>
        )}

        {canManage ? (
          <div className="flex flex-wrap gap-2.5">
            {actions.canChangePlan && (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog("change")}>
                  Change plan
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setDialog("seats")}>
                  Adjust seats
                </Button>
              </>
            )}
            {menu.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" disabled={busy}>
                    More
                    <ChevronDown aria-hidden className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {menu.map((item, i) => (
                    <Fragment key={item.key}>
                      {i > 0 && item.group !== menu[i - 1].group && <DropdownMenuSeparator />}
                      <DropdownMenuItem variant={item.danger ? "destructive" : "default"} onSelect={item.run}>
                        {item.label}
                      </DropdownMenuItem>
                    </Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ) : (
          <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            Read-only for your role.
          </p>
        )}
      </BoardCard>

      {pinningCard}

      {canManage && (
        <>
          <ChangePlanDialog key="change" open={dialog === "change"} {...changeDialogCommon} />
          <ChangePlanDialog
            key="seats"
            open={dialog === "seats"}
            {...changeDialogCommon}
            note={
              <>
                Seats come with the plan: {subscription.plan_name} v{subscription.plan_version} allows{" "}
                {maxSeats === undefined || maxSeats === null ? "unlimited seats" : `${maxSeats} seat${maxSeats === 1 ? "" : "s"}`}, and{" "}
                {props.seatsHeld} {props.seatsHeld === 1 ? "is" : "are"} held. To change the limit, move them to a plan that allows
                the number they need.
              </>
            }
          />
          <CancelDialog
            open={dialog === "cancel"}
            onClose={close}
            periodEnd={subscription.current_period_end}
            busy={busy}
            onCancel={(reason, immediate) =>
              void send(subUrl, "POST", { action: "cancel", reason, immediate }, immediate ? "Subscription cancelled" : "Cancellation queued for period end")
            }
          />
          {trialing && (
            <TrialDialog
              mode={dialog === "trial-extend" ? "extend" : dialog === "trial-convert" ? "convert" : dialog === "trial-end" ? "end" : null}
              onClose={close}
              busy={busy}
              trialEndsAt={subscription.trial_ends_at}
              priceLabel={priceCopy(props.currentPriceCents, subscription.billing_cycle)}
              onSubmit={(body, success) => void send(`/api/admin/trials/${subscription.id}`, "POST", body, success)}
            />
          )}
        </>
      )}
      {canManage && props.coupons && (
        <CouponDialog
          mode={dialog === "coupon-apply" ? "apply" : dialog === "coupon-remove" ? "remove" : null}
          onClose={close}
          busy={busy}
          options={props.coupons.options}
          active={props.coupons.active}
          onApply={(couponId) => void send(`${subUrl}/coupon`, "POST", { coupon_id: couponId }, "Coupon applied")}
          onRemove={() => void send(`${subUrl}/coupon`, "DELETE", undefined, "Coupon removed")}
        />
      )}
    </div>
  );
}

/* ── version pinning ───────────────────────────────────────────────────── */

function VersionPinningCard({ pinning, periodEnd }: { pinning: VersionPinning | null; periodEnd: string | null }) {
  return (
    <BoardCard title="Version pinning">
      {!pinning || pinning.rows.length === 0 ? (
        <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No plan, so no version to pin.</p>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className={st.table}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={cn(st.th, "w-[120px]")}>Version</th>
                <th scope="col" className={cn(st.th, "w-[160px]")}>Live from</th>
                <th scope="col" className={cn(st.th, "w-[120px]")}>On it</th>
                <th scope="col" className={st.th}>This tenant</th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {pinning.rows.map((row) => (
                <tr key={row.planId} className="m-row">
                  <td className={st.td}>
                    v{row.version}
                    {row.isArchived && <span className={st.sub}>Archived</span>}
                  </td>
                  <td className={st.td}>{fullDate(row.liveFrom)}</td>
                  <td className={cn(st.td, "tabular-nums")}>{row.onIt}</td>
                  <td className={st.td}>{row.isCurrent ? <Pill tone="success">Here</Pill> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pinning?.move && <MoveCallout move={pinning.move} periodEnd={periodEnd} />}
    </BoardCard>
  );
}

function MoveCallout({ move, periodEnd }: { move: NonNullable<VersionPinning["move"]>; periodEnd: string | null }) {
  const to = `v${move.toVersion}`;
  const what =
    move.adds.length && move.removes.length
      ? `${to} adds ${listOf(move.adds)} and removes ${listOf(move.removes)}.`
      : move.adds.length
        ? `${to} adds ${listOf(move.adds)}.`
        : move.removes.length
          ? `${to} removes ${listOf(move.removes)}.`
          : `${to} grants the same features as v${move.fromVersion}.`;
  return (
    <p className="m-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
      {what} A move at the same price or less waits until {periodEnd ? fullDate(periodEnd) : "the end of the period"} unless applied now.
    </p>
  );
}

/* ── trial and coupon dialogs ──────────────────────────────────────────── */

function TrialDialog({
  mode,
  onClose,
  busy,
  trialEndsAt,
  priceLabel,
  onSubmit,
}: {
  mode: "extend" | "convert" | "end" | null;
  onClose: () => void;
  busy: boolean;
  trialEndsAt: string | null;
  priceLabel: string;
  onSubmit: (body: Record<string, unknown>, success: string) => void;
}) {
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const dayCount = Number(days);
  const daysValid = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 90;
  const reasonValid = reason.trim().length >= 5;

  const copy = {
    extend: {
      title: "Extend trial",
      description: `Moves the trial end${trialEndsAt ? ` from ${fullDate(trialEndsAt)}` : ""}, here and at the payment provider, so the card is not charged early. It is revenue given away, so a reason is recorded.`,
      cta: "Extend trial",
    },
    convert: {
      title: "Convert to paid now",
      description: `Raises an invoice for the first period (${priceLabel}), charged automatically to the card on file. The subscription turns active when that payment arrives, and its period starts then.`,
      cta: "Convert and charge",
    },
    end: {
      title: "End trial",
      description: "Cancels the subscription now and stops collection at the provider. The reason is recorded in the audit log.",
      cta: "End trial",
    },
  } as const;
  const c = mode ? copy[mode] : null;

  return (
    <Dialog open={mode !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {c && (
          <>
            <DialogHeader>
              <DialogTitle>{c.title}</DialogTitle>
              <DialogDescription>{c.description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {mode === "extend" && (
                <div className="w-40 space-y-1.5">
                  <Label htmlFor="trial-days">Extra days</Label>
                  <Input id="trial-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
                  <p className="text-xs text-muted-foreground">1 to 90 whole days.</p>
                </div>
              )}
              {mode !== "convert" && (
                <div className="space-y-1.5">
                  <Label htmlFor="trial-reason">Reason</Label>
                  <Input id="trial-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Required, and recorded in the audit log.</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Keep as is
              </Button>
              <Button
                variant={mode === "end" ? "destructive" : "default"}
                disabled={busy || (mode === "extend" && (!daysValid || !reasonValid)) || (mode === "end" && !reasonValid)}
                onClick={() =>
                  mode === "extend"
                    ? onSubmit({ action: "extend", days: dayCount, reason: reason.trim() }, `Trial extended by ${dayCount} day${dayCount === 1 ? "" : "s"}`)
                    : mode === "convert"
                      ? onSubmit({ action: "convert" }, "Trial converted")
                      : onSubmit({ action: "cancel", reason: reason.trim() }, "Trial ended")
                }
              >
                {busy ? "Working…" : c.cta}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CouponDialog({
  mode,
  onClose,
  busy,
  options,
  active,
  onApply,
  onRemove,
}: {
  mode: "apply" | "remove" | null;
  onClose: () => void;
  busy: boolean;
  options: { id: string; label: string }[];
  active: { code: string; summary: string } | null;
  onApply: (couponId: string) => void;
  onRemove: () => void;
}) {
  const [couponId, setCouponId] = useState("");
  return (
    <Dialog open={mode !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {mode === "apply" && (
          <>
            <DialogHeader>
              <DialogTitle>Apply a coupon</DialogTitle>
              <DialogDescription>
                The discount applies to our invoices from their next one. A subscription holds one coupon at a time.
                Whop&rsquo;s charge only changes if you also apply the same code to this membership in Whop&rsquo;s
                dashboard &mdash; Whop&rsquo;s API cannot do it from here.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-2">
              <Label htmlFor="coupon-pick">Coupon</Label>
              <Select value={couponId} onValueChange={setCouponId} disabled={options.length === 0}>
                <SelectTrigger id="coupon-pick" className="w-full">
                  <SelectValue placeholder={options.length ? "Choose…" : "No usable coupons"} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {options.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No coupon is active, unexpired and valid on this billing cycle. Coupons are created under Billing.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button disabled={busy || !couponId} onClick={() => onApply(couponId)}>
                {busy ? "Applying…" : "Apply coupon"}
              </Button>
            </DialogFooter>
          </>
        )}
        {mode === "remove" && active && (
          <>
            <DialogHeader>
              <DialogTitle>Remove coupon {active.code}</DialogTitle>
              <DialogDescription>
                Our invoices stop showing the discount from their next one. Whop keeps charging whatever it charges now
                until you also remove the code from this membership in Whop&rsquo;s dashboard &mdash; Whop&rsquo;s API
                cannot do it from here. The redemption is not given back, so the coupon cannot be re-applied to use it
                again.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Keep it
              </Button>
              <Button variant="destructive" disabled={busy} onClick={onRemove}>
                {busy ? "Removing…" : "Remove coupon"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

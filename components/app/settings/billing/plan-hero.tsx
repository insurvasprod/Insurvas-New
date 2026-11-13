"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { Meter, type MeterTone } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { USAGE_CRITICAL_FRACTION, type UsageTier } from "@/lib/billing/selfServiceRules";
import { BILLING_CYCLE_LABELS, formatCentsAsCurrency } from "@/lib/money";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";
import { cn } from "@/lib/utils";

import { EXPORTS, exportHref, n, pct, short, day, type Invoice, type Limit, type View } from "./types";

const STATUS_TONE: Record<SubscriptionStatus, StatusTone> = { trialing: "info", active: "good", past_due: "danger", suspended: "danger", paused: "warning", cancelling: "warning", cancelled: "danger" };
const STATUS_WORD: Record<SubscriptionStatus, string> = { trialing: "Trial", active: "Active", past_due: "Payment failed", suspended: "Read-only", paused: "Paused", cancelling: "Ending", cancelled: "Ended" };
/** Limits never use gold: the warning tone from the platform's threshold (80%) and at 95%, red once full. */
const METER_TONE: Record<UsageTier, MeterTone> = { ok: "neutral", warning: "warning", critical: "warning", full: "danger", over: "danger" };
const CHIP_TONE: Record<UsageTier, StatusTone> = { ok: "neutral", warning: "warning", critical: "warning", full: "danger", over: "danger" };
/** How many features the line names before "+ N more". */
const FEATURES_NAMED = 5;

function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
}

/** One limit: label (with its percentage once it warns), used of limit, the bar, and when it resets. */
function UsageMeter({ limit: l, resting }: { limit: Limit; resting: boolean }) {
  const warns = l.tier !== "ok";
  const chip = l.tier === "over" ? "Over" : l.tier === "full" ? "At the limit" : `${pct(l)}%`;
  // A paused workspace uses nothing that resets: those meters rest (A9).
  const stopped = resting && l.metered;
  const foot = resting
    ? (l.metered ? "Stopped while paused" : l.key === "max_seats" ? "Sign-in still works" : "Plan limit")
    : l.metered
      ? `${l.resetsAt ? `Resets ${short(l.resetsAt)}` : "Resets each period"}${warns && l.hardCap ? ` · stops at ${n(l.limit)}` : ""}`
      : "Plan limit";
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[12px] bg-[var(--surface-alt)] px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--border)]">
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[var(--muted)]">
        <span className="truncate">{l.label}</span>
        {warns && !resting ? <StatusChip tone={CHIP_TONE[l.tier]} className="ml-auto">{chip}</StatusChip> : null}
      </span>
      <strong className="text-base font-semibold text-[var(--ink)] tabular-nums">
        {stopped ? "—" : <>{n(l.used)} <span className="text-xs font-normal text-[var(--muted)]">of {n(l.limit)}</span></>}
      </strong>
      <Meter value={stopped ? 0 : Math.min(l.used, l.limit)} max={l.limit || 1} tone={resting ? "neutral" : METER_TONE[l.tier]} label={`${l.label}: ${n(l.used)} of ${n(l.limit)} used`} />
      <span className="truncate text-xs text-[var(--muted)]">{foot}</span>
    </div>
  );
}

export function PlanHero({ view, overdue, footerLink }: { view: View; overdue: Invoice | null; footerLink: ReactNode }) {
  const [allFeatures, setAllFeatures] = useState(false);
  const sub = view.subscription;
  const plan = view.plan;
  const status = sub?.status;
  const dunning = status === "past_due" || status === "suspended";
  const paused = status === "paused";
  const cycle = sub ? BILLING_CYCLE_LABELS[sub.cycle] : "";
  const per = sub ? `a ${sub.cycle === "monthly" ? "month" : sub.cycle === "quarterly" ? "quarter" : "year"}` : "";

  const subline = !sub
    ? "No subscription · default access"
    : status === "past_due"
      ? `${cycle} · the card${view.dunning?.state === "retrying" && view.dunning.failedAt ? ` was declined on ${short(view.dunning.failedAt)}` : " was declined"}`
      : status === "suspended"
        ? `${cycle} · read-only${view.dunning?.state === "read_only" && view.dunning.since ? ` since ${short(view.dunning.since)}` : ""}`
        : paused
          ? `Resuming bills ${plan?.priceCents != null ? formatCentsAsCurrency(plan.priceCents) : "your plan"}${plan?.addons.length ? ` + ${plan.addons.map((a) => formatCentsAsCurrency(a.priceCents)).join(" + ")}` : ""} that day and starts a new period`
          : status === "cancelling"
            ? `${cycle} · ends ${short(sub.periodEnd)} · no more charges`
            : status === "cancelled"
              ? `Ended ${short(sub.cancelledAt ?? sub.periodEnd)} · records readable until ${day(view.retention.endsAt)}`
              : status === "trialing"
                ? `${cycle} · trial ends ${short(sub.trialEndsAt ?? sub.renewsAt)}`
                : `${cycle} · renews ${short(sub.renewsAt)}${sub.periodStart ? ` · this period began ${short(sub.periodStart)}` : ""}`;

  const features = plan?.features ?? [];
  const named = features.slice(0, FEATURES_NAMED).map((f) => f.label).join(", ");

  return (
    <section id="billing-limits" aria-label="Your plan" className={cn(cardSurface, "flex shrink-0 flex-col scroll-mt-24")}>
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="flex min-w-[260px] flex-1 items-start gap-3">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-[var(--primary-soft)] text-xs font-bold text-[var(--accent-ink)]">{initials(plan?.name ?? "No plan")}</span>
          <div className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <strong className="text-base font-semibold text-[var(--ink)]">{plan?.name ?? "No subscription"}</strong>
              {sub ? <StatusChip tone={STATUS_TONE[sub.status]}>{STATUS_WORD[sub.status]}</StatusChip> : null}
            </span>
            <span className="block text-xs text-[var(--muted)]">{subline}</span>
            {sub?.pendingPlanName ? <span className="block text-xs text-[var(--warning-ink)]">Moving to {sub.pendingPlanName} on {short(sub.periodEnd)}</span> : null}
            {features.length && !dunning ? (
              <span className="mt-1.5 block text-xs text-[var(--body)]">
                {named}{features.length > FEATURES_NAMED ? ` + ${features.length - FEATURES_NAMED} more` : ""} ·{" "}
                <button type="button" aria-expanded={allFeatures} onClick={() => setAllFeatures(!allFeatures)} className="border-0 bg-transparent p-0 font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline">
                  {allFeatures ? "Show less" : "See everything included"}
                </button>
              </span>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          {dunning && overdue ? (
            <>
              <div className="text-title-md font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums">{formatCentsAsCurrency(overdue.totalCents)} <span className="text-sm font-normal tracking-normal text-[var(--muted)]">due</span></div>
              <div className="text-xs text-[var(--muted)]">{status === "past_due" ? "Retried automatically over 5 days" : "Pay it to restore access"}</div>
            </>
          ) : paused ? (
            <div className="text-title-md font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums">{formatCentsAsCurrency(0)} <span className="text-sm font-normal tracking-normal text-[var(--muted)]">while paused</span></div>
          ) : plan?.priceCents != null ? (
            <>
              <div className="text-title-md font-semibold tracking-[-0.02em] text-[var(--ink)] tabular-nums">{formatCentsAsCurrency(plan.priceCents)} <span className="text-sm font-normal tracking-normal text-[var(--muted)]">{per}</span></div>
              {plan.addons.map((a) => <div key={a.name} className="text-xs text-[var(--muted)] tabular-nums">+ {a.name} {formatCentsAsCurrency(a.priceCents)} {BILLING_CYCLE_LABELS[a.cycle].toLowerCase()}</div>)}
            </>
          ) : null}
        </div>
      </div>

      {allFeatures && features.length ? (
        <ul aria-label="What your plan includes" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--body)]">
          {features.map((f) => <li key={f.key}>{f.label}</li>)}
        </ul>
      ) : null}

      {view.limits.length && !dunning ? (
        <div className={cn("grid gap-3 px-4 pb-4 grid-cols-[repeat(auto-fit,minmax(168px,1fr))]", paused && "opacity-60")}>
          {view.limits.map((l) => <UsageMeter key={l.key} limit={l} resting={paused} />)}
        </div>
      ) : null}

      {status === "cancelled" || status === "cancelling" ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">
          <span className="mr-auto">Your records stay readable and exportable until {day(view.retention.endsAt)}.</span>
          {EXPORTS.map((e) => <Button key={e.part} asChild size="sm" variant="outline"><a href={exportHref(e.part)}>Export {e.label.toLowerCase()}</a></Button>)}
        </div>
      ) : !dunning && sub ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-2.5 text-xs text-[var(--muted)]">
          <span className="mr-auto">{view.limits.length ? `Warnings come at ${view.warnPercent}% and ${Math.round(USAGE_CRITICAL_FRACTION * 100)}%. Nothing is cut off without a warning first.` : "Your plan sets no limits."}</span>
          {footerLink}
        </div>
      ) : null}
    </section>
  );
}

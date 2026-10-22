"use client";

/**
 * Settings › Plan & billing (LA-8.5, Notion sprint). The owner's own subscription: plan, price,
 * renewal and features; every limit with its usage (warned at the platform's threshold and at 95%,
 * with the plan change one click away); invoices to print; the card, at the payment provider; and
 * changing, pausing or cancelling — a downgrade names what it takes away from the agency's own
 * records, and a cancellation offers a pause once, states the retention date and offers the export.
 *
 * Every figure comes from /api/app/billing, which owns no price or entitlement rule of its own.
 */

import { useEffect, useState } from "react";

import { Callout, control, KeyValues, SettingsCard, SettingsMeter, SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { dayMonthYear } from "@/lib/format/dates";
import { BILLING_CYCLE_LABELS, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import { notify } from "@/lib/notify";
import { USAGE_CRITICAL_FRACTION, retentionEndsAt, tierWarns, type DunningView, type SelfServeActions, type UsageTier } from "@/lib/billing/selfServiceRules";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";

type Limit = { key: string; label: string; used: number; limit: number; tier: UsageTier; metered: boolean; resetsAt: string | null; hardCap: boolean };
type Invoice = { id: string; number: string; status: string; totalCents: number; periodStart: string | null; periodEnd: string | null; issuedAt: string | null; dueAt: string | null; paidAt: string | null; payOnlineUrl: string | null };
type View = {
  schemaReady: boolean;
  subscription: null | { id: string; status: SubscriptionStatus; statusLabel: string; cycle: BillingCycle; periodStart: string | null; periodEnd: string | null; renewsAt: string | null; trialEndsAt: string | null; pendingPlanName: string | null; cancelledAt: string | null };
  plan: null | { id: string; name: string; priceCents: number | null; features: { key: string; label: string }[]; addons: { name: string; priceCents: number; cycle: BillingCycle }[] };
  limits: Limit[];
  warnPercent: number;
  invoices: Invoice[];
  dunning: DunningView;
  retention: { days: number; endsAt: string | null };
  actions: SelfServeActions | null;
  cardOnFile: boolean;
  planChangeBySupport: boolean;
  options: { id: string; name: string; priceCents: number; applyNow: boolean }[];
};
type Impact = {
  plan: { id: string; name: string };
  preview: { currentPriceCents: number | null; newPriceCents: number | null; applyNow: boolean; proration: { netCents: number; remainingDays: number } | null } | null;
  effectiveAt: string | null;
  featuresLost: { key: string; label: string; records: string | null }[];
  limitsOver: { key: string; label: string; used: number; newLimit: number }[];
};

const day = (iso: string | null) => (iso ? dayMonthYear(iso) : "—");
const n = (value: number) => value.toLocaleString("en-US");
const STATUS_TONE: Record<SubscriptionStatus, StatusTone> = { trialing: "info", active: "good", past_due: "warning", suspended: "danger", paused: "warning", cancelling: "warning", cancelled: "danger" };
const TIER_TONE: Record<UsageTier, "primary" | "warning" | "error"> = { ok: "primary", warning: "warning", critical: "error", full: "error", over: "error" };
const INVOICE_TONE: Record<string, StatusTone> = { paid: "good", issued: "info", overdue: "warning", uncollectible: "danger", void: "neutral" };
const INVOICE_LABEL: Record<string, string> = { paid: "Paid", issued: "Due", overdue: "Overdue", uncollectible: "Uncollectible", void: "Void" };

function tierCaption(l: Limit, warnPercent: number): string {
  const reset = l.metered && l.resetsAt ? ` Resets ${day(l.resetsAt)}.` : "";
  if (l.tier === "over") return `Over the limit by ${n(l.used - l.limit)}.${reset}`;
  if (l.tier === "full") return l.metered ? `${l.hardCap ? "At the limit — no more until it resets or you upgrade." : "At the limit."}${reset}` : "At the limit — upgrade to add more.";
  if (l.tier === "critical") return `Past ${Math.round(USAGE_CRITICAL_FRACTION * 100)}% — ${n(l.limit - l.used)} left.${reset}`;
  if (l.tier === "warning") return `Past ${warnPercent}% — ${n(l.limit - l.used)} left.${reset}`;
  return reset.trim();
}

/** A fresh key per request: the route replays a repeated one instead of changing the plan twice. */
const idempotencyKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function BillingSettings() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [offerPause, setOfferPause] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch("/api/app/billing", { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) { setError(body?.error ?? "Your billing could not be loaded."); return; }
      setError(null);
      setView(body);
    });
    return () => { live = false; };
  }, [reload]);

  async function act(body: Record<string, unknown>, done: string): Promise<{ ok: boolean; code?: string; result?: Record<string, unknown> }> {
    setBusy(true);
    try {
      const res = await fetch("/api/app/billing", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey() }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        if (result?.code === "offer_pause") return { ok: false, code: "offer_pause" };
        notify.fail(result?.error ?? "That change could not be made");
        return { ok: false };
      }
      notify.done(done);
      setReload((r) => r + 1);
      return { ok: true, result };
    } finally {
      setBusy(false);
    }
  }

  async function review(planId: string) {
    setTarget(planId);
    setImpact(null);
    if (!planId) return;
    const res = await fetch(`/api/app/billing?plan=${encodeURIComponent(planId)}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok) { notify.fail(body?.error ?? "That plan could not be checked"); return; }
    setImpact(body);
  }

  async function cancel(pauseDeclined: boolean) {
    const r = await act({ action: "cancel", reason, pause_declined: pauseDeclined }, "Your subscription will end at the end of this period");
    if (r.code === "offer_pause") { setOfferPause(true); return; }
    if (r.ok) { setCancelling(false); setOfferPause(false); setReason(""); }
  }

  if (error) return <SettingsStack><SettingsSectionHeader /><Callout tone="error" title={error} /></SettingsStack>;
  if (!view) return <SettingsStack><SettingsSectionHeader /><SettingsCard><SectionLoading rows={6} columns={3} label="Loading your plan and billing" /></SettingsCard></SettingsStack>;

  const sub = view.subscription;
  const actions = view.actions;
  const warned = view.limits.filter((l) => tierWarns(l.tier));
  const toPlan = () => document.getElementById("billing-plan")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const exportLinks = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline"><a href="/api/app/billing/export?part=policies">Export your book (CSV)</a></Button>
      <Button asChild variant="outline"><a href="/api/app/billing/export?part=commissions">Export commission history (CSV)</a></Button>
    </div>
  );

  return (
    <SettingsStack>
      <SettingsSectionHeader />
      {!view.schemaReady ? <Callout tone="warning" title="Changing your plan here needs a database update." /> : null}

      {/* The state that needs the owner, first. */}
      {view.dunning?.state === "retrying" ? (
        <Callout tone="warning" title="Your last payment did not go through">
          {/* The spec's line: "Payment failed 3 Oct. We will retry on the 6th. Access … pauses on the 8th." — Whop's own dates. */}
          {view.dunning.failedAt ? <>Payment failed {day(view.dunning.failedAt)}. </> : null}
          {view.dunning.triedAgainOn.length ? <>Tried again {view.dunning.triedAgainOn.map(day).join(", ")}. </> : null}
          {view.dunning.nextRetryAt ? <>We will retry on <strong>{day(view.dunning.nextRetryAt)}</strong>. </> : <>The card is retried over five days. </>}
          {view.dunning.accessChangesAt ? <>If no retry succeeds, dialling and applications pause and the workspace becomes read-only on <strong>{day(view.dunning.accessChangesAt)}</strong>.</> : <>If no retry succeeds, the workspace becomes read-only.</>}
          {view.cardOnFile ? <div className="mt-3"><Button asChild><a href="/api/app/billing/payment-method" target="_blank" rel="noopener noreferrer">Update card</a></Button></div> : null}
        </Callout>
      ) : null}
      {view.dunning?.state === "read_only" ? (
        <Callout tone="error" title="The workspace is read-only: payment stopped">
          {view.dunning.since ? <>Since {day(view.dunning.since)}. </> : null}Your records stay readable. Pay the overdue invoice below or update the card to restore access.
        </Callout>
      ) : null}
      {sub?.status === "paused" ? (
        <Callout tone="warning" title="Your subscription is paused">
          The workspace is read-only and nothing is charged while it is paused.
          {actions?.canResume ? <div className="mt-3"><Button type="button" disabled={busy} onClick={() => void act({ action: "resume" }, "Your subscription is active again")}>Resume subscription</Button></div> : null}
        </Callout>
      ) : null}
      {sub?.status === "cancelling" ? (
        <Callout tone="warning" title={`Your subscription ends on ${day(sub.periodEnd)}`}>
          Everything works until then. After it, the workspace is read-only for {view.retention.days} days — your book, statements and commission history can be read and exported until <strong>{day(view.retention.endsAt)}</strong>.
        </Callout>
      ) : null}
      {sub?.status === "cancelled" ? (
        <Callout tone="error" title="Your subscription has ended">
          The workspace is read-only. Your book, statements and commission history can be read and exported until <strong>{day(view.retention.endsAt)}</strong>; after that the workspace can no longer be opened. To have the remaining data deleted, or to start again, contact support@insurvas.com.
          <div className="mt-3">{exportLinks}</div>
        </Callout>
      ) : null}
      {!sub ? <Callout tone="info" title="This workspace has no subscription">It runs on the platform&apos;s default access. To choose a plan, contact support@insurvas.com.</Callout> : null}

      {sub && view.plan ? (
        <SettingsCard title={view.plan.name} sub={view.plan.priceCents !== null ? `${formatCentsAsCurrency(view.plan.priceCents)} · billed ${BILLING_CYCLE_LABELS[sub.cycle].toLowerCase()}` : `Billed ${BILLING_CYCLE_LABELS[sub.cycle].toLowerCase()}`}
          action={<StatusChip tone={STATUS_TONE[sub.status]}>{sub.statusLabel}</StatusChip>}>
          <KeyValues items={[
            { label: sub.status === "trialing" ? "Trial ends" : "Renews", value: sub.renewsAt ? day(sub.renewsAt) : "Does not renew" },
            { label: "This period", value: sub.periodStart ? `${day(sub.periodStart)} – ${day(sub.periodEnd)}` : "—" },
            ...(sub.pendingPlanName ? [{ label: "Changing to", value: `${sub.pendingPlanName} on ${day(sub.periodEnd)}`, tone: "warning" as const }] : []),
            ...(view.plan.addons.length ? [{ label: "Add-ons", value: view.plan.addons.map((a) => `${a.name} (${formatCentsAsCurrency(a.priceCents)} ${BILLING_CYCLE_LABELS[a.cycle].toLowerCase()})`).join(", ") }] : []),
          ]} />
          {view.plan.features.length ? (
            <ul className="m-0 mt-4 flex list-none flex-wrap gap-1.5 p-0" aria-label="What your plan includes">
              {view.plan.features.map((f) => <li key={f.key}><StatusChip tone="neutral">{f.label}</StatusChip></li>)}
            </ul>
          ) : null}
        </SettingsCard>
      ) : null}

      <SettingsCard title="Usage and limits" sub={view.limits.length ? `Warnings at ${view.warnPercent}% and ${Math.round(USAGE_CRITICAL_FRACTION * 100)}%. Metered limits reset each billing period.` : "Your plan sets no limits."}>
        <div id="billing-limits" className="grid gap-5 sm:grid-cols-2">
          {view.limits.map((l) => (
            <SettingsMeter key={l.key} value={l.used} max={l.limit} tone={TIER_TONE[l.tier]} label={l.label} valueLabel={`${n(l.used)} of ${n(l.limit)}`}
              ariaLabel={`${l.label}: ${n(l.used)} of ${n(l.limit)} used`} caption={tierCaption(l, view.warnPercent) || undefined} />
          ))}
        </div>
        {warned.length && actions?.canChangePlan && (view.options.length || view.planChangeBySupport) ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[var(--body)]">
            {warned.length === 1 ? `${warned[0].label} is running out.` : `${warned.length} limits are running out.`}
            <Button type="button" variant="outline" onClick={toPlan}>Upgrade</Button>
          </div>
        ) : null}
      </SettingsCard>

      {sub && actions?.canChangePlan ? (
        <SettingsCard title="Change plan" sub="An upgrade starts now and the rest of this period is added to your next invoice; a downgrade starts when this period ends.">
          <div id="billing-plan" className="flex flex-wrap items-end gap-3">
            {view.options.length ? (
              <label className="flex min-w-[240px] flex-col text-xs text-[var(--muted)]">Move to
                <select className={control} value={target} disabled={busy} onChange={(e) => void review(e.target.value)}>
                  <option value="">Choose a plan</option>
                  {view.options.map((o) => <option key={o.id} value={o.id}>{o.name} — {formatCentsAsCurrency(o.priceCents)} {BILLING_CYCLE_LABELS[sub.cycle].toLowerCase()}</option>)}
                </select>
              </label>
            ) : view.planChangeBySupport ? (
              <p className="m-0 text-sm text-[var(--body)]">Your card is billed through Whop, which cannot switch the plan on an existing membership. Email <a className="underline" href="mailto:support@insurvas.com?subject=Change%20my%20plan">support@insurvas.com</a> and we will move you without a gap.</p>
            ) : <p className="m-0 text-sm text-[var(--muted)]">No other plan is offered on your billing cycle.</p>}
          </div>
          {impact ? (
            <div className="mt-4 flex flex-col gap-3">
              <KeyValues items={[
                { label: "New price", value: impact.preview?.newPriceCents != null ? `${formatCentsAsCurrency(impact.preview.newPriceCents)} ${BILLING_CYCLE_LABELS[sub.cycle].toLowerCase()}` : "—" },
                { label: "Starts", value: impact.preview?.applyNow ? "Now" : day(impact.effectiveAt) },
                ...(impact.preview?.proration ? [{ label: "Added to your next invoice", value: `${formatCentsAsCurrency(impact.preview.proration.netCents)} for the ${impact.preview.proration.remainingDays} days left` }] : []),
              ]} />
              {impact.featuresLost.length ? (
                <Callout tone="warning" title={`${impact.plan.name} does not include ${impact.featuresLost.length === 1 ? "one thing you use now" : `${impact.featuresLost.length} things you use now`}`}>
                  <ul className="m-0 mt-1 list-disc pl-5">
                    {impact.featuresLost.map((f) => <li key={f.key}>{f.label}{f.records ? <> — you would no longer reach <strong>{f.records}</strong></> : null}</li>)}
                  </ul>
                  Nothing is deleted; it comes back if you move up again.
                </Callout>
              ) : null}
              {impact.limitsOver.length ? (
                <Callout tone="warning" title="You are over some of its limits">
                  <ul className="m-0 mt-1 list-disc pl-5">
                    {impact.limitsOver.map((l) => <li key={l.key}>{l.label}: you have {n(l.used)}, it allows {n(l.newLimit)}</li>)}
                  </ul>
                </Callout>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={busy || !view.schemaReady} onClick={() => void act({ action: "change_plan", plan_id: impact.plan.id }, impact.preview?.applyNow ? `You are now on ${impact.plan.name}` : `${impact.plan.name} starts on ${day(impact.effectiveAt)}`).then((r) => { if (r.ok) { setImpact(null); setTarget(""); } })}>
                  {impact.preview?.applyNow ? `Upgrade to ${impact.plan.name}` : `Move to ${impact.plan.name}`}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => { setImpact(null); setTarget(""); }}>Keep my plan</Button>
              </div>
            </div>
          ) : null}
        </SettingsCard>
      ) : null}

      <SettingsCard title="Invoices" sub={view.invoices.length ? undefined : "No invoices yet."}>
        {view.invoices.length ? (
          <ul id="billing-invoices" className="m-0 flex list-none flex-col p-0">
            {view.invoices.map((inv) => (
              <li key={inv.id} className="grid gap-2 border-t border-[var(--border)] py-3 first:border-t-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)] tabular-nums">{inv.number}<StatusChip tone={INVOICE_TONE[inv.status] ?? "neutral"}>{INVOICE_LABEL[inv.status] ?? inv.status}</StatusChip></div>
                  <div className="text-xs text-[var(--muted)] tabular-nums">
                    {inv.periodStart ? `${day(inv.periodStart)} – ${day(inv.periodEnd)}` : `Issued ${day(inv.issuedAt)}`}
                    {inv.paidAt ? ` · paid ${day(inv.paidAt)}` : inv.dueAt && inv.status !== "void" ? ` · due ${day(inv.dueAt)}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--ink)] tabular-nums">{formatCentsAsCurrency(inv.totalCents)}</span>
                  {inv.payOnlineUrl && (inv.status === "issued" || inv.status === "overdue") ? <Button asChild size="sm"><a href={inv.payOnlineUrl} target="_blank" rel="noopener noreferrer">Pay</a></Button> : null}
                  <Button asChild size="sm" variant="outline"><a href={`/app/billing/invoices/${inv.id}`} target="_blank" rel="noopener noreferrer">View or download</a></Button>
                </div>
              </li>
            ))}
          </ul>
        ) : <span id="billing-invoices" />}
      </SettingsCard>

      <SettingsCard title="Payment method" sub={view.cardOnFile ? "Your card is held by our payment provider, Whop — it never passes through Insurvas." : "This workspace pays each invoice by its own link; there is no card on file."}>
        <div id="billing-card">
          {view.cardOnFile ? <Button asChild variant="outline"><a href="/api/app/billing/payment-method" target="_blank" rel="noopener noreferrer">Update card</a></Button> : null}
        </div>
      </SettingsCard>

      {sub && actions && (actions.canPause || actions.canCancel) ? (
        <SettingsCard title="Pause or cancel" sub={`Pausing makes the workspace read-only and stops charges until you resume. Cancelling ends it at the end of this period; your records then stay readable and exportable for ${view.retention.days} days.`}>
          <div id="billing-cancel" className="flex flex-col gap-4">
            {!cancelling ? (
              <div className="flex flex-wrap gap-2">
                {actions.canPause ? <Button type="button" variant="outline" disabled={busy || !view.schemaReady} onClick={() => void act({ action: "pause" }, "Your subscription is paused")}>Pause subscription</Button> : null}
                {actions.canCancel ? <Button type="button" variant="destructive" disabled={busy || !view.schemaReady} onClick={() => setCancelling(true)}>Cancel subscription</Button> : null}
              </div>
            ) : offerPause ? (
              <Callout tone="info" title="Pause instead?">
                A pause keeps your plan, your records and your settings exactly as they are, charges nothing, and you can resume at any time. It is offered once.
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" disabled={busy} onClick={() => void act({ action: "pause" }, "Your subscription is paused").then((r) => { if (r.ok) { setCancelling(false); setOfferPause(false); } })}>Pause instead</Button>
                  <Button type="button" variant="destructive" disabled={busy} onClick={() => void cancel(true)}>Cancel anyway</Button>
                </div>
              </Callout>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="m-0 text-sm text-[var(--body)]">
                  Your subscription ends on <strong>{day(sub.periodEnd)}</strong>. After that the workspace is read-only, and your book, statements and commission history can be read and exported until <strong>{sub.periodEnd ? day(retentionEndsAt(sub.periodEnd, view.retention.days)) : `${view.retention.days} days later`}</strong>; after that the workspace can no longer be opened, and its remaining data is deleted on request to support@insurvas.com. Take a copy now if you like:
                </p>
                {exportLinks}
                <label className="flex flex-col text-xs text-[var(--muted)]">Why are you cancelling?
                  <textarea className={`${control} h-20 py-2`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="destructive" disabled={busy || reason.trim().length < 5} onClick={() => void cancel(false)}>Cancel at the end of this period</Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => { setCancelling(false); setReason(""); }}>Keep my subscription</Button>
                </div>
              </div>
            )}
          </div>
        </SettingsCard>
      ) : null}
    </SettingsStack>
  );
}

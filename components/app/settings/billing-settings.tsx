"use client";

/**
 * Settings › Plan & billing (LA-8.5, Notion sprint; owner pick "B · Three tabs", 2026-10-27). The owner's own
 * subscription, in three tabs under the account's state:
 *
 * - Overview: the plan (price, renewal, period, features, add-ons), every limit with its usage (warned at
 *   the platform's threshold and at 95%, with the plan change one click away), the next charge, the card
 *   and the last invoice.
 * - Change plan: the plans you can move to; picking one shows the new price, when it starts and what is
 *   added to the next invoice before you confirm, and a downgrade names what it takes away from the
 *   agency's own records.
 * - Invoices & payment: the card, at the payment provider; every invoice to view, print or pay; pausing,
 *   and cancelling, which offers a pause once, states the retention date and offers the export.
 *
 * Every figure comes from /api/app/billing, which owns no price or entitlement rule of its own; this screen
 * does no arithmetic on money either.
 */

import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { Callout, control, KeyValues, SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { HoverHint } from "@/components/ui/hover-hint";
import { InfoTip } from "@/components/ui/info-tip";
import { SectionLoading } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { ViewTabs } from "@/components/ui/view-tabs";
import { dayMonthYear } from "@/lib/format/dates";
import { BILLING_CYCLE_LABELS, formatCentsAsCurrency, type BillingCycle } from "@/lib/money";
import { notify } from "@/lib/notify";
import { parseSettingsHash } from "@/lib/settings/registry";
import { cn } from "@/lib/utils";
import { USAGE_CRITICAL_FRACTION, retentionEndsAt, tierWarns, type DunningView, type SelfServeActions, type UsageTier } from "@/lib/billing/selfServiceRules";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";
import { cardSurface } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DangerZone } from "@/components/app/settings/patterns";

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
type Tab = "overview" | "plan" | "invoices";

const day = (iso: string | null) => (iso ? dayMonthYear(iso) : "—");
const n = (value: number) => value.toLocaleString("en-US");
const STATUS_TONE: Record<SubscriptionStatus, StatusTone> = { trialing: "info", active: "good", past_due: "warning", suspended: "danger", paused: "warning", cancelling: "warning", cancelled: "danger" };
const INVOICE_TONE: Record<string, StatusTone> = { paid: "good", issued: "info", overdue: "warning", uncollectible: "danger", void: "neutral" };
const INVOICE_LABEL: Record<string, string> = { paid: "Paid", issued: "Due", overdue: "Overdue", uncollectible: "Uncollectible", void: "Void" };
/** The board's three looks for a limit: comfortable, past the warning, past 95% (or full). */
const TIER_LOOK: Record<UsageTier, { bar: string; text: string; row: string }> = {
  ok: { bar: "bg-[var(--primary)]", text: "text-[var(--ink)]", row: "border-[var(--border)]" },
  warning: { bar: "bg-[var(--warning)]", text: "text-[var(--warning-ink)]", row: "border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)]" },
  critical: { bar: "bg-[var(--error)]", text: "text-[var(--error-ink)]", row: "border-[color-mix(in_srgb,var(--error)_45%,var(--border))] bg-[color-mix(in_srgb,var(--error)_8%,transparent)]" },
  full: { bar: "bg-[var(--error)]", text: "text-[var(--error-ink)]", row: "border-[color-mix(in_srgb,var(--error)_45%,var(--border))] bg-[color-mix(in_srgb,var(--error)_8%,transparent)]" },
  over: { bar: "bg-[var(--error)]", text: "text-[var(--error-ink)]", row: "border-[color-mix(in_srgb,var(--error)_45%,var(--border))] bg-[color-mix(in_srgb,var(--error)_8%,transparent)]" },
};
/** Which tab each of the section's search anchors lives on. */
const ANCHOR_TAB: Record<string, Tab> = { "billing-limits": "overview", "billing-plan": "plan", "billing-invoices": "invoices", "billing-card": "invoices", "billing-cancel": "overview" };
/** A plan can include forty features; the card shows the first few and opens the rest on request. */
const FEATURES_SHOWN = 10;
const KICKER = "flex items-center gap-1 text-xs leading-[1.33] font-semibold tracking-[0.04em] uppercase text-[var(--muted)]";

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

function Card({ title, hint, action, children, className, id }: { title?: string; hint?: string; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn(cardSurface, "flex flex-col gap-3 p-5", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title && <span className={KICKER}>{title}{hint && <HoverHint id={`hint-billing-${title.toLowerCase().replace(/\W+/g, "-")}`} label={`About ${title.toLowerCase()}`}>{hint}</HoverHint>}</span>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function BillingSettings() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [target, setTarget] = useState("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [offerPause, setOfferPause] = useState(false);
  const [allFeatures, setAllFeatures] = useState(false);

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

  // A search result ("#billing/billing-invoices") opens the tab its setting is on, then the rail reveals it.
  useEffect(() => {
    const fromHash = () => {
      const { tab: section, anchor } = parseSettingsHash(window.location.hash);
      if (section === "billing" && anchor && ANCHOR_TAB[anchor]) setTab(ANCHOR_TAB[anchor]);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

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
  if (!view) return <SettingsStack><SettingsSectionHeader /><div className={cardSurface}><SectionLoading rows={6} columns={3} label="Loading your plan and billing" /></div></SettingsStack>;

  const sub = view.subscription;
  const actions = view.actions;
  const warned = view.limits.filter((l) => tierWarns(l.tier));
  const toPlan = () => setTab("plan");
  const cycle = sub ? BILLING_CYCLE_LABELS[sub.cycle].toLowerCase() : "";
  const lastInvoice = view.invoices[0] ?? null;
  const exportLinks = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline"><a href="/api/app/billing/export?part=policies">Export your book (CSV)</a></Button>
      <Button asChild variant="outline"><a href="/api/app/billing/export?part=commissions">Export commission history (CSV)</a></Button>
    </div>
  );
  const updateCard = view.cardOnFile ? <Button asChild variant="outline"><a href="/api/app/billing/payment-method" target="_blank" rel="noopener noreferrer">Update card<ExternalLink aria-hidden="true" /></a></Button> : null;
  const paymentMethod = (
    <div className="flex flex-wrap items-center gap-3.5">
      <span className="grid h-9 w-14 shrink-0 place-items-center rounded-[8px] bg-[var(--surface-alt)] text-xs font-bold tracking-[0.06em] text-[var(--ink)]" aria-hidden="true">{view.cardOnFile ? "CARD" : "LINK"}</span>
      <span className="min-w-[160px] flex-1">
        <strong className="flex items-center gap-1 text-sm font-semibold text-[var(--ink)]">
          {view.cardOnFile ? "Card on file with Whop" : "Paid by invoice link"}
          <InfoTip label="About how you pay">{view.cardOnFile ? "Your card is held by our payment provider, Whop. It never passes through Insurvas." : "Each invoice is paid by its own link. There is no card on file."}</InfoTip>
        </strong>
      </span>
      {updateCard}
    </div>
  );
  const invoiceActions = (inv: Invoice) => (
    <>
      {inv.payOnlineUrl && (inv.status === "issued" || inv.status === "overdue") ? <Button asChild size="sm"><a href={inv.payOnlineUrl} target="_blank" rel="noopener noreferrer">Pay</a></Button> : null}
      <Button asChild size="sm" variant="outline"><a href={`/app/billing/invoices/${inv.id}`} target="_blank" rel="noopener noreferrer">View or download</a></Button>
    </>
  );

  return (
    <SettingsStack>
      <SettingsSectionHeader />
      {!view.schemaReady ? <Callout tone="warning" title="Changing your plan here needs a database update." /> : null}

      {/* The state that needs the owner, first, above the tabs. */}
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
          {view.dunning.since ? <>Since {day(view.dunning.since)}. </> : null}Your records stay readable. Pay the overdue invoice under Invoices &amp; payment or update the card to restore access.
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

      <ViewTabs
        label="Plan and billing"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "overview", label: "Overview" },
          ...(sub && actions?.canChangePlan ? [{ key: "plan" as const, label: "Change plan" }] : []),
          { key: "invoices", label: "Invoices & payment" },
        ]}
      />

      {tab === "overview" && (
        // Two rows that both end level (owner, 2026-10-29: no empty space beside a short column): the
        // plan beside the charge and the last invoice, then usage across the whole width.
        <div className="grid items-stretch gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-3.5 [&>section]:flex-1">
            {sub && view.plan ? (
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className={KICKER}>Your plan</span>
                    <span className="mt-1 flex flex-wrap items-baseline gap-2.5"><h3 className="m-0 text-title-sm font-semibold tracking-[-0.015em] text-[var(--ink)]">{view.plan.name}</h3><StatusChip tone={STATUS_TONE[sub.status]}>{sub.statusLabel}</StatusChip></span>
                  </div>
                  <div className="text-right">
                    {view.plan.priceCents !== null && <><strong className="text-title-sm font-semibold text-[var(--ink)] tabular-nums">{formatCentsAsCurrency(view.plan.priceCents)}</strong><span className="text-sm text-[var(--muted)]"> {cycle}</span></>}
                    <span className="block text-xs text-[var(--muted)]">{sub.renewsAt ? `${sub.status === "trialing" ? "Trial ends" : "Renews"} ${day(sub.renewsAt)}` : "Does not renew"}</span>
                  </div>
                </div>
                {view.plan.features.length ? (
                  <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="What your plan includes">
                    {(allFeatures ? view.plan.features : view.plan.features.slice(0, FEATURES_SHOWN)).map((f) => <li key={f.key} className="rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-ink)]">✓ {f.label}</li>)}
                    {view.plan.features.length > FEATURES_SHOWN ? (
                      <li><button type="button" onClick={() => setAllFeatures(!allFeatures)} aria-expanded={allFeatures} className="rounded-full border border-[var(--border-strong)] px-2.5 py-1 text-xs font-semibold text-[var(--body)] hover:border-[var(--accent-ink)]">{allFeatures ? "Show fewer" : `+ ${view.plan.features.length - FEATURES_SHOWN} more`}</button></li>
                    ) : null}
                  </ul>
                ) : null}
                <KeyValues items={[
                  { label: "This period", value: sub.periodStart ? `${day(sub.periodStart)} – ${day(sub.periodEnd)}` : "—" },
                  ...(sub.pendingPlanName ? [{ label: "Changing to", value: `${sub.pendingPlanName} on ${day(sub.periodEnd)}`, tone: "warning" as const }] : []),
                  ...(view.plan.addons.length ? [{ label: "Add-ons", value: view.plan.addons.map((a) => `${a.name} (${formatCentsAsCurrency(a.priceCents)} ${BILLING_CYCLE_LABELS[a.cycle].toLowerCase()})`).join(", ") }] : []),
                ]} />
              </Card>
            ) : null}

          </div>

          <div className="flex min-w-0 flex-col gap-3.5">
            {sub && view.plan ? (
              <Card title="Next charge">
                <strong className="text-title-sm font-semibold text-[var(--ink)] tabular-nums">
                  {sub.status === "paused" ? "Nothing while paused" : !sub.renewsAt ? "None — it does not renew" : view.plan.priceCents !== null ? `${formatCentsAsCurrency(view.plan.priceCents)} on ${day(sub.renewsAt)}` : day(sub.renewsAt)}
                </strong>
                {view.plan.addons.length ? <span className="text-xs text-[var(--muted)]">Plus your add-ons</span> : null}
                {paymentMethod}
              </Card>
            ) : null}
            <Card title="Last invoice" className="flex-1">
              {lastInvoice ? (
                <>
                  <span className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2 text-[var(--body)] tabular-nums">{day(lastInvoice.issuedAt ?? lastInvoice.periodStart)} · {lastInvoice.number}<StatusChip tone={INVOICE_TONE[lastInvoice.status] ?? "neutral"}>{INVOICE_LABEL[lastInvoice.status] ?? lastInvoice.status}</StatusChip></span><strong className="text-[var(--ink)] tabular-nums">{formatCentsAsCurrency(lastInvoice.totalCents)}</strong></span>
                  <span className="flex flex-wrap gap-2">{invoiceActions(lastInvoice)}<Button type="button" size="sm" variant="ghost" onClick={() => setTab("invoices")}>See all invoices</Button></span>
                </>
              ) : <p className="m-0 text-sm text-[var(--muted)]">No invoices yet.</p>}
            </Card>
          </div>

            <Card
              id="billing-limits"
              className="lg:col-span-2"
              title={view.limits.length ? `Usage · ${warned.length ? `${warned.length} limit${warned.length === 1 ? "" : "s"} close to full` : "all limits comfortable"}` : "Usage"}
              hint={`Warnings come at ${view.warnPercent}% and ${Math.round(USAGE_CRITICAL_FRACTION * 100)}%, with the plan change one click away. Metered limits reset each billing period.`}
            >
              {view.limits.length === 0 && <p className="m-0 text-sm text-[var(--muted)]">Your plan sets no limits.</p>}
              <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
              {view.limits.map((l) => {
                const look = TIER_LOOK[l.tier];
                const caption = tierCaption(l, view.warnPercent);
                return (
                  <div key={l.key} className={cn("flex flex-col gap-2 rounded-[12px] border px-3.5 py-3", look.row)}>
                    <span className="flex items-baseline justify-between gap-2.5"><strong className="text-sm font-semibold text-[var(--ink)]">{l.label}</strong><span className={cn("text-sm font-semibold tabular-nums", look.text)}>{n(l.used)} of {n(l.limit)}{l.metered ? " this period" : ""}</span></span>
                    <span className="h-1.5 rounded-full bg-[var(--surface-alt)]" role="meter" aria-label={`${l.label}: ${n(l.used)} of ${n(l.limit)} used`} aria-valuemin={0} aria-valuemax={l.limit} aria-valuenow={Math.min(l.used, l.limit)}>
                      <span className={cn("block h-1.5 rounded-full transition-[width] duration-300", look.bar)} style={{ width: `${l.limit ? Math.min(100, (l.used / l.limit) * 100) : 100}%` }} />
                    </span>
                    <span className="flex flex-wrap items-center justify-between gap-2.5 text-xs text-[var(--muted)]">
                      <span>{l.metered ? (l.resetsAt ? `Resets ${day(l.resetsAt)}` : "Resets each period") : "Plan limit"}</span>
                      {tierWarns(l.tier) && caption ? <span className={cn("font-semibold", look.text)}>{caption.replace(/ Resets [^.]+\.$/, "")}</span> : null}
                    </span>
                  </div>
                );
              })}
              </div>
              {warned.length && actions?.canChangePlan && (view.options.length || view.planChangeBySupport) ? (
                <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--body)]">
                  {warned.length === 1 ? `${warned[0].label} is running out.` : `${warned.length} limits are running out.`}
                  <Button type="button" variant="outline" onClick={toPlan}>Upgrade</Button>
                </div>
              ) : null}
            </Card>
        </div>
      )}
          {tab === "overview" && sub && actions && (actions.canPause || actions.canCancel) ? (
            <div id="billing-cancel" className="scroll-mt-24">
            {/* Settings redesign R5: the two steps that stop the workspace, apart from everything else, last. */}
            <DangerZone title="Pause or cancel">
              <div className="flex flex-col gap-3 p-4">
              <p className="m-0 text-sm text-[var(--muted)]">{`Pausing makes the workspace read-only and stops charges until you resume. Cancelling ends it at the end of this period; your records then stay readable and exportable for ${view.retention.days} days.`}</p>
              {!cancelling ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-[var(--body)]">Your book stays readable either way.</span>
                  <span className="flex flex-wrap gap-2">
                    {actions.canPause ? <Button type="button" variant="outline" disabled={busy || !view.schemaReady} onClick={() => void confirmAction({ title: "Pause your subscription?", description: "The workspace becomes read-only and charges stop until you resume. Nothing is deleted.", confirmLabel: "Pause subscription", cancelLabel: "Keep it running" }).then((sure) => { if (sure) void act({ action: "pause" }, "Your subscription is paused"); })}>Pause subscription</Button> : null}
                    {actions.canCancel ? <Button type="button" variant="destructive" disabled={busy || !view.schemaReady} onClick={() => setCancelling(true)}>Cancel subscription</Button> : null}
                  </span>
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
            </DangerZone>
            </div>
          ) : null}

      {tab === "plan" && sub && actions?.canChangePlan && (
        <div id="billing-plan" className="flex flex-col gap-3.5">
          {view.planChangeBySupport ? (
            <Callout tone="info" title="Plan changes for card-billed agencies go through support">
              Your card is billed through Whop, which cannot switch the plan on an existing membership. Email <a className="underline" href="mailto:support@insurvas.com?subject=Change%20my%20plan">support@insurvas.com</a> and we will move you without a gap.
            </Callout>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {view.plan ? (
              <div className={cn(cardSurface, "flex flex-col gap-2 border-[1.5px] border-[var(--primary)] bg-[var(--primary-soft)] p-4")}>
                <span className="flex items-center justify-between"><span className={KICKER}>Now</span><span className="text-xs font-bold text-[var(--accent-ink)]">Current plan</span></span>
                <strong className="text-base font-semibold text-[var(--ink)]">{view.plan.name}</strong>
                {view.plan.priceCents !== null && <span><strong className="text-title-sm font-semibold text-[var(--ink)] tabular-nums">{formatCentsAsCurrency(view.plan.priceCents)}</strong><span className="text-xs text-[var(--muted)]"> {cycle}</span></span>}
                <span className="text-xs font-semibold text-[var(--muted)]">What you pay now</span>
              </div>
            ) : null}
            {view.options.map((o) => {
              const on = target === o.id;
              return (
                <button key={o.id} type="button" disabled={busy} onClick={() => void review(on ? "" : o.id)} aria-pressed={on}
                  className={cn(cardSurface, "flex flex-col gap-2 border-[1.5px] p-4 text-left transition-colors disabled:cursor-wait", on ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "hover:border-[var(--border-strong)]")}>
                  <span className={KICKER}>{o.applyNow ? "Upgrade" : "Smaller plan"}</span>
                  <strong className="text-base font-semibold text-[var(--ink)]">{o.name}</strong>
                  <span><strong className="text-title-sm font-semibold text-[var(--ink)] tabular-nums">{formatCentsAsCurrency(o.priceCents)}</strong><span className="text-xs text-[var(--muted)]"> {cycle}</span></span>
                  <span className={cn("text-xs font-semibold", o.applyNow ? "text-[var(--warning-ink)]" : "text-[var(--info-ink)]")}>{o.applyNow ? "Starts now" : `Starts ${day(sub.periodEnd)}, when this period ends`}</span>
                  <span className="text-xs text-[var(--muted)]">{on ? "Shown below: what changes" : "Pick it to see what changes"}</span>
                </button>
              );
            })}
          </div>
          {view.options.length === 0 && !view.planChangeBySupport ? <p className="m-0 text-sm text-[var(--muted)]">No other plan is offered on your billing cycle.</p> : null}

          <Card title="Add-ons" hint="Extra room without changing plan. Add-ons are attached by Insurvas for now.">
            {view.plan?.addons.length
              ? <ul className="m-0 flex list-none flex-wrap gap-2 p-0">{view.plan.addons.map((a) => <li key={a.name} className="rounded-[10px] border border-[var(--border)] px-3 py-2 text-sm"><strong className="font-semibold text-[var(--ink)]">{a.name}</strong><span className="block text-xs text-[var(--muted)]">{formatCentsAsCurrency(a.priceCents)} {BILLING_CYCLE_LABELS[a.cycle].toLowerCase()}</span></li>)}</ul>
              : <p className="m-0 text-sm text-[var(--muted)]">No add-ons on your plan. To add more room, email <a className="underline" href="mailto:support@insurvas.com?subject=Add-on">support@insurvas.com</a>.</p>}
          </Card>

          {impact ? (
            <Card title={impact.preview?.applyNow ? `Upgrade to ${impact.plan.name}` : `Move to ${impact.plan.name}`} className="border-[color-mix(in_srgb,var(--primary)_40%,var(--border))]">
              <KeyValues items={[
                { label: "New price", value: impact.preview?.newPriceCents != null ? `${formatCentsAsCurrency(impact.preview.newPriceCents)} ${cycle}` : "—" },
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
            </Card>
          ) : null}
        </div>
      )}

      {tab === "invoices" && (
        // Side by side, like Overview: the invoice list beside the one payment method (2026-10-29).
        <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card id="billing-invoices" title="Invoices" className="lg:order-1">
            {view.invoices.length ? (
              <ul className="m-0 flex list-none flex-col p-0">
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
                      {invoiceActions(inv)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 text-sm text-[var(--muted)]">No invoices yet.</p>}
          </Card>
          <Card id="billing-card" title="Payment method" className="lg:order-2">{paymentMethod}</Card>
        </div>
      )}
    </SettingsStack>
  );
}

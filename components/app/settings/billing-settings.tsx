"use client";

/**
 * Settings › Plan & billing (LA-8.5; Settings round 8, owner pick A "Plan hero + sheets", 2026-11-12).
 * One page, no tabs: the account's state on the status line under the title, the plan with its usage
 * meters on top, invoices and payment side by side under it. Everything that changes the subscription
 * opens over the page: Compare plans and the change's impact as right sheets, an upgrade's confirm as
 * a dialog with the money in dollars, pause or cancel as one stepped sheet, an invoice as a sheet.
 *
 * Dunning, read-only, paused, cancelling and cancelled ride the status line with their one fix, never
 * a notice card. Limits warn in the warning tone at the platform's threshold and at 95%, with the reset
 * date; gold is the one Upgrade button. A card-billed (Whop) agency cannot switch plan itself
 * (`planChangeBySupport`): its confirm becomes "Ask support to move me". The card is updated on Whop's
 * own page. Retention days come from the view.
 *
 * Every figure comes from /api/app/billing, which owns no price or entitlement rule of its own; this
 * screen does no arithmetic on money either.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { StatusLine, type StatusTone } from "@/components/app/settings/cadence/shared";
import { CompareSheet } from "@/components/app/settings/billing/compare-sheet";
import { ImpactSheet, UpgradeDialog } from "@/components/app/settings/billing/change-plan";
import { InvoiceSheet, INVOICE_TONE } from "@/components/app/settings/billing/invoice-sheet";
import { PauseCancelSheet } from "@/components/app/settings/billing/pause-cancel-sheet";
import { PlanHero } from "@/components/app/settings/billing/plan-hero";
import { INVOICE_LABEL, SUPPORT_EMAIL, exportHref, idempotencyKey, pct, short, day, type Impact, type Invoice, type View } from "@/components/app/settings/billing/types";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { FactTable } from "@/components/ui/fact-table";
import { ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { tierWarns } from "@/lib/billing/selfServiceRules";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";
import { parseSettingsHash } from "@/lib/settings/registry";
import { cn } from "@/lib/utils";

type Overlay =
  | { kind: "compare"; pick: string | null }
  | { kind: "impact"; impact: Impact }
  | { kind: "upgrade"; impact: Impact }
  | { kind: "pause"; start: "choose" | "cancel" }
  | { kind: "invoice"; invoice: Invoice }
  | null;

const LINK = "border-0 bg-transparent p-0 font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline";
const payable = (inv: Invoice) => Boolean(inv.payOnlineUrl) && (inv.status === "issued" || inv.status === "overdue");

/** The one line under the title: where the account stands, and the one thing that fixes it. */
function statusOf(view: View, open: (o: Overlay) => void, overdue: Invoice | null): { tone: StatusTone; text: ReactNode; action?: ReactNode } {
  const sub = view.subscription;
  const plan = view.plan;
  const updateCard = view.cardOnFile ? <a className={LINK} href="/api/app/billing/payment-method" target="_blank" rel="noopener noreferrer">update card</a> : null;
  const pay = overdue && payable(overdue) ? <a className={LINK} href={overdue.payOnlineUrl!} target="_blank" rel="noopener noreferrer">pay {formatCentsAsCurrency(overdue.totalCents)}</a> : null;
  const tail = view.schemaReady ? "" : " · changing your plan here needs a database update; billing still works";
  if (!sub) return { tone: "neutral", text: `No subscription · this workspace runs on default access${tail}`, action: <a className={LINK} href={`mailto:${SUPPORT_EMAIL}?subject=Choose%20a%20plan`}>contact support</a> };

  if (view.dunning?.state === "retrying") {
    const d = view.dunning;
    return {
      tone: "danger",
      // Whop's own dates (selfServiceRules.dunningView): failed on, tried again on, retry on, access pauses on.
      text: <>
        {`Your ${d.failedAt ? `${short(d.failedAt)} ` : ""}payment${overdue ? ` of ${formatCentsAsCurrency(overdue.totalCents)}` : ""} didn't go through`}
        {d.triedAgainOn.length ? ` · tried again ${d.triedAgainOn.map(short).join(", ")}` : ""}
        {d.nextRetryAt ? ` · we retry ${short(d.nextRetryAt)}` : " · the card is retried over five days"}
        {d.accessChangesAt ? ` · if no retry works, dialing and applications pause on ${short(d.accessChangesAt)}` : " · if no retry works, the workspace becomes read-only"}
        {tail}
      </>,
      action: updateCard ?? pay,
    };
  }
  if (view.dunning?.state === "read_only") {
    return { tone: "danger", text: `Read-only: payment stopped${view.dunning.since ? ` on ${short(view.dunning.since)}` : ""} · your book is readable${tail}`, action: pay ?? updateCard };
  }
  switch (sub.status) {
    case "paused":
      return { tone: "warning", text: `Paused · your book is read-only · no charges until you resume · exports still work${tail}` };
    case "cancelling":
      return { tone: "warning", text: `Ends ${short(sub.periodEnd)} · no more charges · records readable until ${day(view.retention.endsAt)}${tail}`, action: <a className={LINK} href={`mailto:${SUPPORT_EMAIL}?subject=Keep%20my%20subscription`}>keep my subscription</a> };
    case "cancelled":
      return { tone: "danger", text: `Ended ${short(sub.cancelledAt ?? sub.periodEnd)} · records readable and exportable until ${day(view.retention.endsAt)}${tail}`, action: <a className={LINK} href={exportHref("policies")}>export</a> };
  }

  // Live: the next charge, then the limit closest to full.
  const next = sub.status === "trialing"
    ? `Trial · ends ${short(sub.trialEndsAt ?? sub.renewsAt)}${plan?.priceCents != null ? ` · then ${formatCentsAsCurrency(plan.priceCents)} ${sub.cycle === "monthly" ? "a month" : sub.cycle === "quarterly" ? "a quarter" : "a year"}` : ""}`
    : `Active${sub.renewsAt && plan?.priceCents != null ? ` · next charge ${formatCentsAsCurrency(plan.priceCents)}${plan.addons.length ? " + add-ons" : ""} on ${short(sub.renewsAt)}` : ""}`;
  const worst = [...view.limits].filter((l) => tierWarns(l.tier)).sort((a, b) => pct(b) - pct(a))[0];
  const moving = sub.pendingPlanName ? ` · moving to ${sub.pendingPlanName} on ${short(sub.periodEnd)}` : "";
  const compare = view.actions?.canChangePlan && view.options.length ? <button type="button" className={LINK} onClick={() => open({ kind: "compare", pick: view.options.find((o) => o.applyNow)?.id ?? null })}>compare plans</button> : undefined;
  if (!worst) return { tone: sub.status === "trialing" ? "warning" : "good", text: `${next}${moving}${tail}` };
  const reset = worst.metered && worst.resetsAt ? `, resets ${short(worst.resetsAt)}` : "";
  if (worst.tier === "full" || worst.tier === "over") {
    return { tone: "danger", text: `${next} · ${worst.label.toLowerCase()} ${worst.tier === "over" ? "over" : "at"} the limit${worst.metered && worst.hardCap ? ` · stopped until ${short(worst.resetsAt)}` : reset}${moving}${tail}`, action: compare };
  }
  return { tone: "warning", text: `${next} · ${worst.label.toLowerCase()} at ${pct(worst)}% of your limit${reset}${moving}${tail}`, action: compare };
}

export function BillingSettings() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(null);

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

  // A search result ("#billing/billing-plan") opens what its setting lives in: Compare plans, or Pause or cancel.
  const handledHash = useRef<string | null>(null);
  useEffect(() => {
    if (!view) return;
    const fromHash = () => {
      // Once per hash: a reload after a change must not open the sheet again.
      if (handledHash.current === window.location.hash) return;
      handledHash.current = window.location.hash;
      const { tab: section, anchor } = parseSettingsHash(window.location.hash);
      if (section !== "billing" || !anchor) return;
      if (anchor === "billing-plan" && view.actions?.canChangePlan && view.options.length) setOverlay({ kind: "compare", pick: null });
      else if (anchor === "billing-cancel" && (view.actions?.canPause || view.actions?.canCancel)) setOverlay({ kind: "pause", start: view.actions.canPause ? "choose" : "cancel" });
      else document.getElementById(anchor)?.scrollIntoView({ block: "nearest" });
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [view]);

  async function act(body: Record<string, unknown>, done: string): Promise<{ ok: boolean; code?: string }> {
    setBusy(true);
    try {
      const res = await fetch("/api/app/billing", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey() }, body: JSON.stringify(body) });
      const result = await res.json().catch(() => null);
      if (!res.ok) {
        if (result?.code === "offer_pause") return { ok: false, code: "offer_pause" };
        notify.fail(result?.error ?? "That change could not be made");
        return { ok: false, code: result?.code };
      }
      notify.done(done);
      setReload((r) => r + 1);
      return { ok: true };
    } finally {
      setBusy(false);
    }
  }

  async function review(planId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/app/billing?plan=${encodeURIComponent(planId)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as (Impact & { error?: string }) | null;
      if (!res.ok || !body) { notify.fail(body?.error ?? "That plan could not be checked"); return; }
      // A plain upgrade confirms in a dialog; anything that takes something away is shown in full.
      const plain = body.preview?.applyNow && !body.featuresLost.length && !body.limitsOver.length;
      setOverlay({ kind: plain ? "upgrade" : "impact", impact: body });
    } finally {
      setBusy(false);
    }
  }

  async function changePlan(impact: Impact) {
    const now = Boolean(impact.preview?.applyNow);
    const r = await act({ action: "change_plan", plan_id: impact.plan.id }, now ? `You're on ${impact.plan.name} now` : `${impact.plan.name} starts on ${short(impact.effectiveAt)}`);
    if (r.ok) setOverlay(null);
  }

  async function pause() {
    return (await act({ action: "pause" }, "Your subscription is paused")).ok;
  }

  async function cancel(reason: string) {
    if (!view) return false;
    const done = `Your subscription will end on ${short(view.subscription?.periodEnd ?? null)}`;
    const first = await act({ action: "cancel", reason, pause_declined: false }, done);
    if (first.ok) return true;
    if (first.code !== "offer_pause") return false;
    // The server records the one-time pause offer as it refuses. The sheet showed that offer when the
    // view said it was due; otherwise the view is stale — reload so the offer shows before anything ends.
    if (!view.actions?.offerPauseFirst) { notify.fail("Pausing keeps your records and your plan — have a look before you cancel."); setReload((r) => r + 1); return false; }
    return (await act({ action: "cancel", reason, pause_declined: true }, done)).ok;
  }

  if (error) return <SettingsStack><SettingsSectionHeader /><div className={cardSurface}><ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => { setError(null); setReload((r) => r + 1); }}>Try again</Button>} /></div></SettingsStack>;
  if (!view) return <SettingsStack><SettingsSectionHeader /><div className={cardSurface}><SectionLoading rows={6} columns={3} label="Opening your plan and billing" /></div></SettingsStack>;

  const sub = view.subscription;
  const actions = view.actions;
  const status = sub?.status;
  const dunning = status === "past_due" || status === "suspended";
  const overdue = view.invoices.find((i) => i.status === "overdue") ?? view.invoices.find((i) => i.status === "issued") ?? null;
  const line = statusOf(view, setOverlay, overdue);
  const canCompare = Boolean(sub && actions?.canChangePlan && view.options.length);
  const upgradeTo = view.options.find((o) => o.applyNow);
  const updateCardButton = (variant: "default" | "outline", size?: "sm") => view.cardOnFile
    ? <Button asChild variant={variant} size={size}><a href="/api/app/billing/payment-method" target="_blank" rel="noopener noreferrer">Update card<ExternalLink aria-hidden="true" /></a></Button>
    : null;

  const headerActions = status === "paused" ? (
    <>
      {actions?.canCancel ? <Button type="button" variant="outline" disabled={busy} onClick={() => setOverlay({ kind: "pause", start: "cancel" })}>Cancel instead</Button> : null}
      {actions?.canResume ? <Button type="button" disabled={busy || !view.schemaReady} onClick={() => void act({ action: "resume" }, "Your subscription is active again")}>Resume subscription</Button> : null}
    </>
  ) : (
    <>
      {canCompare ? <Button type="button" id="billing-plan" variant="outline" onClick={() => setOverlay({ kind: "compare", pick: null })}>Compare plans</Button> : null}
      {dunning ? updateCardButton("default") : canCompare && upgradeTo ? <Button type="button" variant="highlight" onClick={() => setOverlay({ kind: "compare", pick: upgradeTo.id })}>Upgrade</Button> : null}
    </>
  );

  const quietLink = actions && (actions.canPause || actions.canCancel) && status !== "paused" ? (
    <button type="button" id="billing-cancel" className="border-0 bg-transparent p-0 text-xs font-medium text-[var(--muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline" onClick={() => setOverlay({ kind: "pause", start: actions.canPause ? "choose" : "cancel" })}>
      {actions.canPause ? "Pause or cancel…" : "Cancel subscription…"}
    </button>
  ) : null;

  const invoices = (
    <TableCard
      title="Invoices"
      action={<span className="text-xs text-[var(--muted)]">{view.invoices.length === 1 ? "1 invoice" : `${view.invoices.length} invoices`}</span>}
      className={cn("min-h-[240px] min-w-0", dunning ? "flex-1" : "")}
      bodyClassName="min-h-0 lg:overflow-y-auto lg:overscroll-contain"
    >
      {view.invoices.length ? (
        <Table data-even="off">
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>For</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.invoices.map((inv) => (
              <TableRow key={inv.id} className={cn(inv.status === "overdue" && "bg-[var(--surface-alt)]")}>
                <TableCell className="tabular-nums">{inv.number}</TableCell>
                <TableCell className="tabular-nums">{day(inv.issuedAt)}</TableCell>
                <TableCell className="tabular-nums">{inv.periodStart ? `${short(inv.periodStart)} – ${short(inv.periodEnd)}` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCentsAsCurrency(inv.totalCents)}</TableCell>
                <TableCell><StatusChip tone={INVOICE_TONE[inv.status] ?? "neutral"}>{INVOICE_LABEL[inv.status] ?? inv.status}</StatusChip></TableCell>
                <TableCell className="text-right">
                  <span className="inline-flex items-center gap-1">
                    {payable(inv) ? <Button asChild size="sm"><a href={inv.payOnlineUrl!} target="_blank" rel="noopener noreferrer">Pay {formatCentsAsCurrency(inv.totalCents)}</a></Button> : null}
                    <Button type="button" size="sm" variant="ghost" className="text-[var(--accent-ink)]" onClick={() => setOverlay({ kind: "invoice", invoice: inv })}>View</Button>
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : <p className="m-0 px-4 py-6 text-sm text-[var(--muted)]">No invoices yet.</p>}
    </TableCard>
  );

  const payment = (
    <section id="billing-card" aria-label="Payment" className={cn(cardSurface, "flex min-h-0 min-w-0 flex-col scroll-mt-24")}>
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-2.5"><h3 className="m-0 text-sm font-semibold text-[var(--ink)]">Payment</h3></div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3 lg:overflow-y-auto">
        <FactTable labelWidth={110} rows={[
          ["Next charge", sub && view.plan ? (
            <strong className="font-semibold text-[var(--ink)]">
              {status === "paused" ? "Nothing while paused" : !sub.renewsAt ? "None — it does not renew" : view.plan.priceCents !== null ? `${formatCentsAsCurrency(view.plan.priceCents)} on ${short(sub.renewsAt)}` : short(sub.renewsAt)}
            </strong>
          ) : "—"],
          ["Plus", sub?.renewsAt && view.plan?.addons.length ? <span className="text-xs text-[var(--muted)]">{view.plan.addons.map((a) => `${a.name} ${formatCentsAsCurrency(a.priceCents)}`).join(" + ")}</span> : null],
          ["Paid with", view.cardOnFile ? "Card on file with Whop" : "Each invoice's own payment link"],
        ]} />
        <div className="flex flex-wrap gap-2">{updateCardButton("outline", "sm")}</div>
        <p className="m-0 text-xs text-[var(--muted)]">{view.cardOnFile ? "Your card is held by our payment provider, Whop. It never passes through Insurvas." : "Each invoice is paid by its own link. There is no card on file."}</p>
      </div>
    </section>
  );

  const stillWorks = (
    <section aria-label="What still works" className={cn(cardSurface, "flex min-h-0 min-w-0 flex-col")}>
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-2.5"><h3 className="m-0 text-sm font-semibold text-[var(--ink)]">What still works</h3></div>
      <div className="min-h-0 flex-1 px-4 py-1 lg:overflow-y-auto">
        {([["Your book, policies and commissions", "good", "Readable"], ["Exports and invoices", "good", "Working"], ["Dialing, applications, lead posting", "neutral", "Stopped"], ["Partner portal", "neutral", "Read-only"]] as const).map(([what, tone, word]) => (
          <div key={what} className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 text-sm last:border-b-0">
            <span className="font-medium text-[var(--ink)]">{what}</span>
            <StatusChip tone={tone} className="ml-auto">{word}</StatusChip>
          </div>
        ))}
        {updateCardButton("outline", "sm") ? <div className="py-2.5">{updateCardButton("outline", "sm")}</div> : null}
      </div>
    </section>
  );

  return (
    <SettingsStack className="min-h-0 flex-1 gap-3">
      <SettingsSectionHeader actions={sub ? headerActions : undefined} />
      <StatusLine tone={line.tone} action={line.action}>{line.text}</StatusLine>

      {/* The page does not scroll; each card does (foundation). On a short window the column scrolls as one. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-0.5 @container">
        <PlanHero view={view} overdue={dunning ? overdue : null} footerLink={quietLink} />
        {dunning ? (
          <div id="billing-invoices" className="flex min-h-0 flex-1 flex-col">{invoices}</div>
        ) : (
          <div className="grid min-h-[280px] flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div id="billing-invoices" className="flex min-h-0 min-w-0 flex-col [&>section]:flex-1">{invoices}</div>
            {status === "paused" ? stillWorks : payment}
          </div>
        )}
      </div>

      {overlay?.kind === "compare" ? <CompareSheet view={view} initial={overlay.pick} busy={busy} onClose={() => setOverlay(null)} onReview={(id) => void review(id)} /> : null}
      {overlay?.kind === "impact" ? <ImpactSheet view={view} impact={overlay.impact} busy={busy} onClose={() => setOverlay(null)} onConfirm={() => void changePlan(overlay.impact)} /> : null}
      {overlay?.kind === "upgrade" ? <UpgradeDialog view={view} impact={overlay.impact} busy={busy} onClose={() => setOverlay(null)} onConfirm={() => void changePlan(overlay.impact)} /> : null}
      {overlay?.kind === "pause" ? <PauseCancelSheet view={view} start={overlay.start} busy={busy} onClose={() => setOverlay(null)} onPause={pause} onCancel={cancel} /> : null}
      {overlay?.kind === "invoice" ? <InvoiceSheet invoice={overlay.invoice} onClose={() => setOverlay(null)} /> : null}
    </SettingsStack>
  );
}

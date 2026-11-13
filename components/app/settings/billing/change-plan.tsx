"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FactTable } from "@/components/ui/fact-table";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { BILLING_CYCLE_LABELS, formatCentsAsCurrency } from "@/lib/money";

import { askSupportHref, day, n, short, type Impact, type View } from "./types";

/** What the subscription is billed at, besides the plan: its add-ons, named with their prices. */
function addonLine(view: View) {
  const addons = view.plan?.addons ?? [];
  return addons.length ? addons.map((a) => `${a.name} ${formatCentsAsCurrency(a.priceCents)}`).join(" + ") : null;
}

/**
 * A3 · Change-plan impact (a smaller plan, or any plan that takes something away): what you would pay,
 * when, what you would lose and which of its limits you are over. The move waits for the renewal date.
 */
export function ImpactSheet({ view, impact, busy, onClose, onConfirm }: {
  view: View;
  impact: Impact;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const sub = view.subscription;
  const per = sub ? BILLING_CYCLE_LABELS[sub.cycle].toLowerCase() : "";
  const now = Boolean(impact.preview?.applyNow);
  const when = now ? "now" : short(impact.effectiveAt);
  const addons = addonLine(view);
  const newPrice = impact.preview?.newPriceCents;
  const lost = impact.featuresLost;
  const over = impact.limitsOver;
  return (
    <Sheet
      title={`${now ? "Upgrade" : "Move"} to ${impact.plan.name}`}
      subtitle={view.plan ? `from ${view.plan.name}` : undefined}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Keep my plan</Button>
          {view.planChangeBySupport ? (
            <Button asChild><a href={askSupportHref(view.plan?.name ?? "my plan", impact.plan.name)}>Ask support to move me<ExternalLink aria-hidden="true" /></a></Button>
          ) : (
            <Button type="button" disabled={busy || !view.schemaReady} onClick={onConfirm}>{now ? `Upgrade now` : `Move on ${when}`}</Button>
          )}
        </div>
      }
    >
      <FactTable rows={[
        ["New price", newPrice != null ? `${formatCentsAsCurrency(newPrice)} ${per}` : "—"],
        ["Starts", now ? "Straight away" : `${day(impact.effectiveAt)}, at your renewal`],
        [impact.preview?.proration ? `For the ${impact.preview.proration.remainingDays} days left` : "Days left", impact.preview?.proration ? `${formatCentsAsCurrency(impact.preview.proration.netCents)} on your next invoice` : null],
        ["Next charge", newPrice != null ? <strong className="font-semibold">{formatCentsAsCurrency(newPrice)} on {short(now ? sub?.periodEnd ?? null : impact.effectiveAt)}</strong> : "—"],
        ["Plus add-ons", addons ? <span className="text-xs text-[var(--muted)]">{addons}</span> : null],
      ]} />

      {lost.length ? (
        <div className="border-t border-[var(--border)] pt-3">
          <h3 className="m-0 mb-1 text-sm font-semibold text-[var(--ink)]">You&apos;d lose {lost.length === 1 ? "1 thing" : `${lost.length} things`} you use now</h3>
          {lost.map((f) => (
            <div key={f.key} className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 text-sm last:border-b-0">
              <span className="font-medium text-[var(--ink)]">{f.label}</span>
              {f.records ? <span className="min-w-0 truncate text-xs text-[var(--muted)]">{f.records} today</span> : null}
              <StatusChip tone="warning" className="ml-auto">Stops {now ? "now" : when}</StatusChip>
            </div>
          ))}
        </div>
      ) : null}

      {over.length ? (
        <div className="border-t border-[var(--border)] pt-3">
          <h3 className="m-0 mb-1 text-sm font-semibold text-[var(--ink)]">You&apos;re over {over.length === 1 ? "1 of its limits" : `${over.length} of its limits`}</h3>
          {over.map((l) => (
            <div key={l.key} className="flex items-center gap-3 border-b border-[var(--border)] py-2.5 text-sm last:border-b-0">
              <span className="font-medium text-[var(--ink)]">{l.label}</span>
              <span className="min-w-0 truncate text-xs text-[var(--muted)]">{n(l.used)} in use · {impact.plan.name} allows {n(l.newLimit)}</span>
              {l.key === "max_seats" ? <Link href="/app/settings#team-access" className="ml-auto shrink-0 text-xs font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline">Team &amp; access ›</Link> : null}
            </div>
          ))}
        </div>
      ) : null}

      {lost.length || over.length ? <p className="m-0 text-xs text-[var(--muted)]">Nothing is deleted. It comes back if you move up again.</p> : null}
      {view.planChangeBySupport ? <p className="m-0 text-xs text-[var(--muted)]">Your card is billed through Whop, which can&apos;t switch the plan on a membership. Support moves you without a gap.</p> : null}
    </Sheet>
  );
}

/**
 * A4 · Confirm an upgrade: the money in dollars from the proration preview — the new price, what the
 * days left in this period add to the next invoice, and when that invoice comes.
 */
export function UpgradeDialog({ view, impact, busy, onClose, onConfirm }: {
  view: View;
  impact: Impact;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const sub = view.subscription;
  const per = sub ? BILLING_CYCLE_LABELS[sub.cycle].toLowerCase() : "";
  const proration = impact.preview?.proration ?? null;
  const newPrice = impact.preview?.newPriceCents;
  const addons = addonLine(view);
  const bySupport = view.planChangeBySupport;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upgrade to {impact.plan.name}{bySupport ? "?" : " now?"}</DialogTitle>
          <DialogDescription>
            {bySupport
              ? "Your card is billed through Whop, which can't switch the plan on a membership. Support moves you without a gap, at these prices."
              : `The new limits start straight away.${proration ? " You pay the difference for the days left in this period on your next invoice." : ""}`}
          </DialogDescription>
        </DialogHeader>
        <FactTable rows={[
          ["New price", newPrice != null ? `${formatCentsAsCurrency(newPrice)} ${per}` : "—"],
          [proration ? `For the ${proration.remainingDays} days left` : "Days left", proration ? formatCentsAsCurrency(proration.netCents) : null],
          ["Next invoice", <strong key="next" className="font-semibold">{short(sub?.periodEnd ?? null)}: {newPrice != null ? formatCentsAsCurrency(newPrice) : "the new price"}{proration ? ` + ${formatCentsAsCurrency(proration.netCents)}` : ""}{addons ? ` + ${addons}` : ""}</strong>],
          ["Paid with", view.cardOnFile ? "Your card on file with Whop" : "The invoice's own payment link"],
        ]} />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Not now</Button>
          {bySupport ? (
            <Button asChild><a href={askSupportHref(view.plan?.name ?? "my plan", impact.plan.name)}>Ask support to move me<ExternalLink aria-hidden="true" /></a></Button>
          ) : (
            <Button type="button" disabled={busy || !view.schemaReady} onClick={onConfirm}>Upgrade now</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

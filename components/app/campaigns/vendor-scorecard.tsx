"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { BadgeDollarSign, ChevronDown, Clock, HandCoins, KeyRound, Pencil, PhoneOff, Plus, ShieldCheck, Target, Timer, Trash2, Trophy, Wallet, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { daysLeft, duration, LEAD_TYPE, money, percent, VendorFacts, VendorSignals, type RosterConsent, type RosterRollup, type RosterSpeed, type RosterVendor } from "@/components/app/vendor-roster";
import { Figure } from "@/components/app/campaigns/figure";
import { costTone, highIsGood, lowIsGood, speedTone, type FigureTone } from "@/components/app/campaigns/tones";
import { cn } from "@/lib/utils";
import type { VendorCardFacts, VendorCardsResponse } from "@/lib/vendors/types";

type Shown = { key: string; icon: ReactNode; label: string; value: string | null; tone?: FigureTone; meaning: string };

/**
 * The picked vendor's scorecard, above its campaigns (A · Vendor first, owner 2026-10-28; /ui-taste
 * critique 2026-10-29): only the figures that have data, as icon + value coloured green / amber /
 * red, close together beside the vendor's actions; a figure without data is not drawn. Details opens the vendor's read-only facts in place;
 * Edit opens just the edit form; Order another opens New campaign with this vendor chosen.
 */
export function VendorScorecard({ vendor, rollup, fact, facts, speed, consent, usableReference, onEdit, onDelete, deleting = false, onOrderAnother }: {
  vendor: RosterVendor;
  rollup: RosterRollup | undefined;
  fact: VendorCardFacts | undefined;
  facts: VendorCardsResponse | null;
  speed: RosterSpeed | undefined;
  consent: RosterConsent | undefined;
  usableReference: number | null;
  onEdit: () => void;
  /** "Delete vendor": the shared two-step confirm (delete-vendor.tsx). */
  onDelete: () => void;
  deleting?: boolean;
  onOrderAnother: () => void;
}) {
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const best = facts?.best ?? null;
  const isBest = Boolean(best && best.vendor_id === vendor.id);
  const policyTone = !fact || fact.trialling ? null : isBest ? "good" : fact.drop?.reasons.some((reason) => reason.key === "cost") ? "danger" : costTone(fact.cost_per_policy_cents, best?.cost_per_policy_cents);
  const posted = Boolean(speed?.posted_leads);
  const orderDisabled = vendor.status !== "active" && vendor.status !== "under_review";
  const category = vendor.category ?? fact?.category ?? null;
  // Consent is judged only where a certificate is expected: real-time posts. A list or aged vendor
  // with none is shown, uncoloured, rather than painted red for something it never sold.
  const consentKnown = Boolean(consent && consent.claimed_coverage_pct !== null && (consent.leads ?? 1) > 0);
  const consentTone = consentKnown && vendor.lead_type === "realtime" ? highIsGood(consent?.claimed_coverage_pct, 90, 50) : null;
  const known = (value: number | null | undefined) => value !== null && value !== undefined;

  const figures: Shown[] = [
    { key: "spend", icon: <Wallet />, label: "Spend", value: rollup && rollup.total_spend_cents > 0 ? money(rollup.total_spend_cents) : null, meaning: "Spent with this vendor, all campaigns" },
    { key: "usable", icon: <Target />, label: "Per usable", value: known(rollup?.cost_per_usable_record_cents) ? money(rollup?.cost_per_usable_record_cents) : null, tone: costTone(rollup?.cost_per_usable_record_cents, usableReference), meaning: "Cost per usable lead, after the scrub. Green is at or under your average cost per dialable lead." },
    { key: "policy", icon: isBest ? <Trophy /> : <BadgeDollarSign />, label: fact?.trialling ? "Per policy · trial" : "Per policy", value: known(fact?.cost_per_policy_cents) ? money(fact?.cost_per_policy_cents) : null, tone: policyTone, meaning: fact?.trialling ? "Cost per issued policy. Not ranked while trialling." : isBest ? "Cost per issued policy — the cheapest ranked vendor" : "Cost per issued policy" },
    { key: "median", icon: <Timer />, label: "Median to dial", value: posted && known(speed?.median_seconds) ? duration(speed?.median_seconds) : null, tone: posted ? speedTone(speed?.median_seconds) : null, meaning: "Speed to lead: arrival to first dial, the median. Real-time leads only." },
    { key: "60s", icon: <Zap />, label: "Under 60s", value: posted && known(speed?.dialled_within_60s_pct) ? percent(speed?.dialled_within_60s_pct) : null, tone: posted ? highIsGood(speed?.dialled_within_60s_pct, 80, 50) : null, meaning: "Share of posted leads dialled within 60 seconds; a lead nobody dialled counts against it" },
    { key: "consent", icon: <ShieldCheck />, label: "Consent", value: consentKnown ? percent(consent?.claimed_coverage_pct) : null, tone: consentTone, meaning: vendor.lead_type === "realtime" ? "Leads with a claimed consent certificate — high is good" : "Leads with a claimed consent certificate. Not judged for list or aged leads." },
    { key: "undialable", icon: <PhoneOff />, label: "Undialable", value: known(fact?.undialable_percent) ? percent(fact?.undialable_percent) : null, tone: lowIsGood(fact?.undialable_percent, 5, 15), meaning: "Share of this vendor's rows that could never be dialled — low is good" },
    { key: "claims", icon: <HandCoins />, label: "Claims credited", value: known(fact?.claim_acceptance_percent) ? percent(fact?.claim_acceptance_percent) : null, tone: highIsGood(fact?.claim_acceptance_percent, 80, 50), meaning: "Of what you claimed back from this vendor, the share they credited — high is good" },
  ];
  const withData = figures.filter((figure) => figure.value !== null);

  // Labels show when the card is wide; narrower (1440px with the rail and the vendor list open) the
  // buttons keep their icons, names and tooltips, so they fit on the figures' line.
  const word = "sr-only @4xl:not-sr-only";
  const buttons = <span className="ml-auto flex shrink-0 items-center gap-1.5">
    {vendor.lead_type === "realtime" && <Button asChild variant="ghost" size="sm" title="Posting key"><Link href="/app/settings#lead-posting"><KeyRound aria-hidden="true" /><span className={word}>Posting key</span></Link></Button>}
    <Button type="button" variant="ghost" size="sm" title="Details" aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails((value) => !value)}><ChevronDown className={cn("transition-transform", details && "rotate-180")} aria-hidden="true" /><span className={word}>Details</span></Button>
    <Button type="button" variant="outline" size="sm" title="Edit vendor" onClick={onEdit}><Pencil aria-hidden="true" /><span className={word}>Edit</span></Button>
    <Button type="button" variant="outline" size="sm" title="Delete vendor" className="border-[var(--error-ink)] text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]" disabled={deleting} onClick={onDelete}><Trash2 aria-hidden="true" /><span className={word}>Delete vendor</span></Button>
    <Button type="button" variant="outline" size="sm" disabled={orderDisabled} title={orderDisabled ? "Set this vendor to active to order more." : "Order another — a new campaign from this vendor, nothing is bought"} onClick={onOrderAnother}><Plus aria-hidden="true" /><span className={word}>Order another</span></Button>
  </span>;

  return <section aria-label={`${vendor.name} scorecard`} className="m-glass @container flex flex-none flex-col gap-2 rounded-lg border border-border px-4 py-2.5">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="m-0 min-w-0 truncate text-base font-semibold text-[var(--ink)]">{vendor.name}</h2>
      <span className="text-xs text-[var(--muted)]">{category ? `${category} · ` : ""}{LEAD_TYPE[vendor.lead_type] ?? vendor.lead_type}{rollup ? ` · ${rollup.active_campaign_count} of ${rollup.campaign_count} active` : ""}</span>
      <VendorSignals vendorId={vendor.id} status={vendor.status} fact={fact} />
    </div>
    {/* Owner 2026-10-29: the figures sit close together on the left, the actions on the same line on
        the right; a figure without data is simply not drawn. */}
    <div className="flex items-start gap-4">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-1.5">
        {withData.map((figure) => <Figure dense key={figure.key} icon={figure.icon} label={figure.label} value={figure.value} tone={figure.tone ?? null} meaning={figure.meaning} />)}
        {fact?.claimable && <Figure dense icon={<Clock />} label="Claimable" value={`${money(fact.claimable.cents)} · ${Math.max(0, fact.claimable.days_left)}d`} tone="danger" meaning={`Credit you can still claim back, ${daysLeft(fact.claimable.days_left)}`} />}
      </div>
      {buttons}
    </div>
    {details && <div id={detailsId} className="border-t border-border pt-3"><VendorFacts vendor={rollup} row={vendor} fact={fact} /></div>}
  </section>;
}

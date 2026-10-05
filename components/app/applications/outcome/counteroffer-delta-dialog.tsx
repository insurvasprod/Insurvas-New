"use client";

/**
 * The counteroffer delta view (LA-3.26; board l3-ov-counteroffer), laid out to be read to the
 * client: applied for, offered, and the difference — face and premium in dollars and percent, the
 * benefit type, the rating class and (when the notice gives them) the effective dates — all worked
 * out already. Accepting or declining never deletes the record.
 */

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { CounterofferView } from "@/lib/applications/types";
import { cn } from "@/lib/utils";
import { daysBetween, firstDraftOn } from "@/lib/applications/afterSubmitRules";

import { face, money } from "@/components/app/applications/parts";
import { Overlay } from "@/components/app/applications/submit/overlay";
import { counterofferDelta, dayMonth, expiryOf, tierChangeLine, tierName } from "./model";

export type OfferDetail = { applied: { effectiveOn: string | null; fycCents: number | null }; offered: { effectiveOn: string | null; fycCents: number | null } };

export function CounterofferDeltaDialog({ open, onOpenChange, offer, detail, carrierName, attemptNo, productLabel, draftDay, pronoun, now, busy, onAnswer }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offer: CounterofferView;
  detail: OfferDetail | null;
  carrierName: string | null;
  attemptNo: number;
  productLabel: string | null;
  draftDay: number | null;
  /** "she" / "he" / "they", from the insured's gender. */
  pronoun: "she" | "he" | "they";
  now: number;
  busy: boolean;
  onAnswer: (response: "accept" | "reject") => void;
}) {
  const d = counterofferDelta(offer.applied, offer.offered);
  const expiry = expiryOf(offer.expiresAt, now);
  const product = productLabel ?? "Coverage";
  const obj = pronoun === "she" ? "her" : pronoun === "he" ? "him" : "them";
  const lead = pronoun === "they"
    ? "They applied for one thing and have been offered another. Read them the right-hand column, not the left."
    : `${pronoun === "she" ? "She" : "He"} applied for one thing and has been offered another. Read ${obj} the right-hand column, not the left.`;
  const appliedOn = detail?.applied.effectiveOn ?? null;
  const offeredOn = detail?.offered.effectiveOn ?? null;
  const shift = appliedOn && offeredOn ? daysBetween(appliedOn, offeredOn) : null;
  const neg = (cents: number) => (cents < 0 ? "text-[var(--error-ink)]" : cents > 0 ? "text-[var(--success-ink)]" : "text-[var(--muted)]");

  const rows: { label: string; applied: string; offered: string; diff: ReactNode }[] = [
    { label: "Face amount", applied: face(offer.applied.faceCents), offered: face(offer.offered.faceCents), diff: <Diff main={d.face} sub={d.faceCents ? d.facePercent : null} className={neg(d.faceCents)} /> },
    { label: "Monthly premium", applied: money(offer.applied.monthlyCents), offered: money(offer.offered.monthlyCents), diff: <Diff main={d.monthly} sub={d.monthlyCents ? d.monthlyPercent : null} className={neg(d.monthlyCents)} /> },
    { label: "Product", applied: `${product} · ${tierName(offer.applied.tier).toLowerCase()}`, offered: `${product} · ${tierName(offer.offered.tier).toLowerCase()}`, diff: <span className={cn("text-xs font-semibold", d.tierChanged ? "text-[var(--warning-ink)]" : "text-[var(--muted)]")}>{tierChangeLine(offer.applied.tier, offer.offered.tier)}</span> },
    ...(offer.applied.healthClass || offer.offered.healthClass
      ? [{ label: "Rating class", applied: offer.applied.healthClass ?? "—", offered: offer.offered.healthClass ?? "—", diff: <span className="text-xs text-[var(--muted)]">{d.classChanged ? "Changed" : "No change"}</span> }]
      : []),
    ...(appliedOn || offeredOn
      ? [{
        label: "Effective date", applied: dayMonth(appliedOn, true), offered: dayMonth(offeredOn, true),
        diff: <Diff main={shift === null ? "—" : shift === 0 ? "No change" : `${shift > 0 ? "+" : "−"}${Math.abs(shift)} days`} sub={offeredOn && draftDay ? `First draft ${dayMonth(firstDraftOn(offeredOn, draftDay))}` : null} className={shift ? "text-[var(--warning-ink)]" : "text-[var(--muted)]"} />,
      }]
      : []),
  ];
  const fyc = detail && detail.applied.fycCents !== null && detail.offered.fycCents !== null ? detail : null;

  return (
    <Overlay
      open={open}
      onOpenChange={(o) => { if (!busy) onOpenChange(o); }}
      width={840}
      title={`${carrierName ?? "The carrier"} has come back with a different policy`}
      subtitle={`Attempt ${attemptNo} · offered ${dayMonth(offer.receivedAt)} · expires ${dayMonth(offer.expiresAt)}`}
      headerExtra={<StatusChip tone={expiry.tone === "danger" ? "danger" : "warning"}>{expiry.label}</StatusChip>}
      footerNote={`Accepting updates the coverage, reissues the welcome pack and recalculates the commission${fyc ? ` (estimated FYC ${money(fyc.applied.fycCents)} → ${money(fyc.offered.fycCents)})` : ""}.`}
      actions={<>
        <Button type="button" variant="outline" onClick={() => onAnswer("reject")} disabled={busy} title={busy ? "Saving…" : undefined}>Client declined</Button>
        <Button type="button" onClick={() => onAnswer("accept")} disabled={busy} title={busy ? "Saving…" : undefined}>Accept the offer</Button>
      </>}
    >
      <p className="text-sm text-[var(--body)]">{lead}</p>
      <div className="overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="bg-[var(--surface-alt)]">
              <th className="w-[150px] px-3 py-2"><span className="sr-only">Term</span></th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">Applied for</th>
              <th className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">Offered</th>
              <th className="w-[168px] px-3 py-2 text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">Difference</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((r) => (
              <tr key={r.label} className="m-row">
                <th scope="row" className="border-t border-[var(--border)] px-3 py-2 font-semibold text-[var(--body)]">{r.label}</th>
                <td className="border-t border-[var(--border)] px-3 py-2 text-[var(--body)] tabular-nums">{r.applied}</td>
                <td className="border-t border-[var(--border)] px-3 py-2 font-semibold text-[var(--ink)] tabular-nums">{r.offered}</td>
                <td className="border-t border-[var(--border)] px-3 py-2 tabular-nums">{r.diff}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Overlay>
  );
}

function Diff({ main, sub, className }: { main: string; sub: string | null; className: string }) {
  return (
    <span className="flex flex-col">
      <span className={cn("text-sm font-semibold", className)}>{main}</span>
      {sub && <span className="text-xs text-[var(--muted)]">{sub}</span>}
    </span>
  );
}

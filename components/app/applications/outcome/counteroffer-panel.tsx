"use client";

/**
 * A pending counteroffer on the After step (LA-3.26; board l3-ws-after): what they applied for,
 * what the carrier offered, and the difference already worked out — dollars and percent — so no one
 * does arithmetic on a live call. The countdown runs to expires_at. The client's answer is given in
 * the delta overlay (l3-ov-counteroffer); "Let it expire" closes it as offer_expired.
 */

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { CounterofferView } from "@/lib/applications/types";

import { face, money, shortDate } from "@/components/app/applications/parts";
import { counterofferDelta, expiryOf } from "./model";

export function CounterofferPanel({ offer, carrierName, now, readOnly, busy, onAccept, onDecline, onExpire }: {
  offer: CounterofferView;
  carrierName: string | null;
  now: number;
  readOnly: boolean;
  busy?: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onExpire: () => void;
}) {
  const d = counterofferDelta(offer.applied, offer.offered);
  const expiry = expiryOf(offer.expiresAt, now);
  const cells: [string, string][] = [
    ["Applied for", `${face(offer.applied.faceCents)} · ${money(offer.applied.monthlyCents)}/mo`],
    ["Offered", `${face(offer.offered.faceCents)} · ${money(offer.offered.monthlyCents)}/mo`],
    ["Difference", `${d.faceCents === 0 ? "No change" : d.face} face · ${d.monthlyCents === 0 ? "no change" : d.monthly}/mo`],
    ["As a percentage", `${d.facePercent} face · ${d.monthlyPercent} premium`],
  ];
  const disabledWhy = readOnly ? "This attempt is closed" : busy ? "Saving…" : undefined;
  return (
    <section aria-label="Counteroffer" className="rounded-[12px] border border-[var(--border)] border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] p-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-semibold text-[var(--ink)]">{carrierName ?? "The carrier"} came back with a counteroffer</h2>
          <StatusChip tone={expiry.tone === "danger" ? "danger" : "warning"} title={`Expires ${shortDate(offer.expiresAt)}`}>{expiry.label}</StatusChip>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          {cells.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">{label}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-[var(--ink)] tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {offer.reason && <p className="text-sm text-[var(--body)]"><span className="text-[var(--muted)]">Reason: </span>{offer.reason}</p>}
        <div className="flex flex-wrap gap-2.5">
          <Button type="button" variant="ghost" onClick={onExpire} disabled={Boolean(disabledWhy)} title={disabledWhy ?? "Close it as expired — the client gave no answer"}>Let it expire</Button>
          <Button type="button" variant="outline" onClick={onDecline} disabled={Boolean(disabledWhy)} title={disabledWhy}>Client declined</Button>
          <Button type="button" onClick={onAccept} disabled={Boolean(disabledWhy)} title={disabledWhy}>Accept the offer</Button>
        </div>
      </div>
    </section>
  );
}

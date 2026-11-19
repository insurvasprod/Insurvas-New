"use client";

import { Card } from "@/components/ui/card";
import type { OfferRow } from "@/lib/offers/constants";
import { OFFER_STATE, stateOf } from "@/lib/offers/present";
import { cn } from "@/lib/utils";

const MONTHS = 3;
// Hand-built, in UTC: Node's ICU prints "Sept" where browsers print "Sep", which breaks hydration.
const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = { format: (t: number) => NAMES[new Date(t).getUTCMonth()] };
const DAY = { format: (t: number) => { const d = new Date(t); return `${NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`; } };

const BAR: Record<"active" | "scheduled" | "ended" | "overlap", string> = {
  active: "bg-[var(--primary)]",
  scheduled: "bg-[var(--info)]",
  ended: "bg-[var(--border-strong)]",
  overlap: "bg-[var(--warning)]",
};

/**
 * The offers' windows on one calendar (admin round 1, billing-r2 screen 9): this month and the next two, one bar per
 * offer that is on during them, so a gap or a pile-up is seen at a glance. An offer that could apply together with
 * another is drawn in the warning colour; a bar opens its offer. Deactivated offers are left off: they apply to nobody.
 */
export function OfferCalendar({ offers, now, overlapping, onOpen }: {
  offers: OfferRow[];
  now: number;
  overlapping: ReadonlySet<string>;
  onOpen: (id: string) => void;
}) {
  const today = new Date(now);
  const from = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
  const to = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + MONTHS, 1);
  const span = to - from;
  const months = Array.from({ length: MONTHS }, (_, i) => Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + i, 1));
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - from) / span) * 100));

  const rows = offers
    .map((offer) => {
      const state = stateOf(offer, now);
      const start = offer.starts_at ? Date.parse(offer.starts_at) : -Infinity;
      const end = offer.ends_at ? Date.parse(offer.ends_at) : Infinity;
      return { offer, state, start, end };
    })
    .filter(({ state, start, end }) => state !== "inactive" && end >= from && start < to)
    .sort((a, b) => a.start - b.start || a.offer.name.localeCompare(b.offer.name));

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4" aria-labelledby="offer-calendar-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="offer-calendar-title" className="m-0 text-sm font-semibold text-foreground">Calendar</h2>
        <span className="text-xs text-muted-foreground">{MONTH.format(months[0])} – {MONTH.format(months[MONTHS - 1])}</span>
      </div>
      <div className="relative grid grid-cols-3 text-xs text-muted-foreground" aria-hidden="true">
        {months.map((m) => <span key={m} className="border-l border-border pl-1.5">{MONTH.format(m)}</span>)}
      </div>
      {rows.length === 0 ? (
        <p className="m-0 py-4 text-sm text-muted-foreground">No offer is on in these three months.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {rows.map(({ offer, state, start, end }) => {
            const left = pct(start);
            const width = Math.max(1.5, pct(end) - left);
            const tone = overlapping.has(offer.id) ? "overlap" : state === "inactive" ? "ended" : state;
            const window = `${Number.isFinite(start) ? DAY.format(start) : "Always"} – ${Number.isFinite(end) ? DAY.format(end) : "no end"}`;
            return (
              <li key={offer.id}>
                <button type="button" onClick={() => onOpen(offer.id)} className="group flex w-full flex-col gap-1 text-left" aria-label={`${offer.name}, ${OFFER_STATE[state].label.toLowerCase()}, ${window}`}>
                  <span className="flex min-w-0 justify-between gap-2 text-xs">
                    <span className="truncate text-foreground group-hover:underline">{offer.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{window}</span>
                  </span>
                  <span className="relative block h-2 w-full rounded-full bg-[var(--surface-alt)]">
                    <span className={cn("absolute inset-y-0 rounded-full", BAR[tone])} style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />
                    <span className="absolute inset-y-[-3px] w-px bg-[var(--ink)]" style={{ left: `${pct(now)}%` }} title="Today" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", BAR.active)} />Active</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", BAR.scheduled)} />Scheduled</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", BAR.overlap)} />Overlaps</span>
        <span className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", BAR.ended)} />Ended</span>
      </p>
    </Card>
  );
}

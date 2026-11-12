"use client";

/**
 * Settings › Dialing cadence · the timeline (round 8, board A). Days across, parts of the day down,
 * one dot per call of the example lead. A dot drags sideways to change its wait (and up or down to
 * prefer another part of the day); click or Enter opens the call's popover; ← → change the wait a
 * day, ↑ ↓ the part of the day, Delete removes the call. Dashed dots are where the rule wanted a call
 * that calling windows moved; striped days take no calls.
 *
 * The dots are grid items placed in call order, so Tab walks the calls in order whatever row they
 * sit in.
 */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BANDS, shortWait, type Band } from "@/lib/cadence/draft";
import { closedDay, dayLabel, type CallingRules, type SimulatedCall } from "@/lib/cadence/timeline";
import { cn } from "@/lib/utils";

import { PART_STRIPE, STRIPE, dotClass } from "./shared";

const BAND_LABEL: Record<Band, { name: string; hours: string }> = {
  morning: { name: "Morning", hours: "before noon" },
  afternoon: { name: "Afternoon", hours: "noon–5pm" },
  evening: { name: "Evening", hours: "from 5pm" },
};

export type TimelineMove = { n: number; deltaDays: number; band: Band | null };

export function CadenceTimeline({
  calls,
  startDate,
  days,
  rules,
  compact = false,
  outsideBand,
  ownCalls,
  editable,
  openCall,
  onOpenCall,
  onMove,
  onRemove,
  renderPopover,
  label,
}: {
  calls: SimulatedCall[];
  startDate: string;
  days: number;
  rules: CallingRules;
  compact?: boolean;
  /** Bands a campaign's narrower hours leave out, with the reason ("after 6pm"). */
  outsideBand?: Partial<Record<Band, string>>;
  /** Calls whose rule is this outcome's own (drawn in the info tint). */
  ownCalls?: ReadonlySet<number>;
  editable: boolean;
  openCall?: number | null;
  onOpenCall?: (n: number | null) => void;
  onMove?: (move: TimelineMove) => void;
  onRemove?: (n: number) => void;
  renderPopover?: (n: number) => ReactNode;
  label: string;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ n: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [target, setTarget] = useState<{ n: number; day: number; band: Band } | null>(null);
  const [focusCall, setFocusCall] = useState<number | null>(null);

  // A move re-places the dot; keep the keyboard on it.
  useEffect(() => {
    if (focusCall === null) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-call="${focusCall}"]`)?.focus();
  }, [calls, focusCall]);

  const closed = Array.from({ length: days }, (_, day) => closedDay(startDate, day, rules));
  const byCell = new Map<string, SimulatedCall[]>();
  for (const call of calls) {
    if (call.day >= days) continue;
    const key = `${call.day}|${call.band}`;
    byCell.set(key, [...(byCell.get(key) ?? []), call]);
  }
  const ghosts = calls.filter((call) => call.wanted && call.wanted.day < days);
  const columns: CSSProperties = { gridTemplateColumns: `${compact ? 76 : 92}px repeat(${days}, minmax(0, 1fr))` };
  const rowOf = (band: Band) => BANDS.indexOf(band) + 2;
  const later = calls.filter((call) => call.day >= days).length;

  const cellAt = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-cell]");
    if (!element || !gridRef.current?.contains(element)) return null;
    return { day: Number(element.dataset.day), band: element.dataset.band as Band };
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>, call: SimulatedCall) => {
    if (!editable || call.n === 1 || event.button !== 0) return;
    drag.current = { n: call.n, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state) return;
    if (!state.moved && Math.hypot(event.clientX - state.x, event.clientY - state.y) < 5) return;
    state.moved = true;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell) setTarget({ n: state.n, ...cell });
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>, call: SimulatedCall) => {
    const state = drag.current;
    drag.current = null;
    if (!state?.moved) return;
    suppressClick.current = true;
    const cell = cellAt(event.clientX, event.clientY) ?? (target ? { day: target.day, band: target.band } : null);
    setTarget(null);
    if (!cell) return;
    const deltaDays = cell.day - call.day;
    const band = cell.band !== call.band ? cell.band : null;
    if (deltaDays !== 0 || band) onMove?.({ n: call.n, deltaDays, band });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, call: SimulatedCall) => {
    if (!editable || call.n === 1) return;
    const band = BANDS.indexOf(call.band);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setFocusCall(call.n);
      onMove?.({ n: call.n, deltaDays: event.key === "ArrowRight" ? 1 : -1, band: null });
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = BANDS[(band + (event.key === "ArrowDown" ? 1 : BANDS.length - 1)) % BANDS.length];
      setFocusCall(call.n);
      onMove?.({ n: call.n, deltaDays: 0, band: next });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onRemove?.(call.n);
    }
  };

  const tip = (call: SimulatedCall) => {
    if (!target || target.n !== call.n) return null;
    const delta = target.day - call.day;
    return `${delta === 0 ? "Same wait" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${Math.abs(delta) === 1 ? "day" : "days"}`} · ${dayLabel(startDate, target.day)}, ${BAND_LABEL[target.band].name.toLowerCase()}`;
  };

  const cellKeys = [...byCell.keys()].sort((a, b) => (byCell.get(a)?.[0].n ?? 0) - (byCell.get(b)?.[0].n ?? 0));

  return (
    <div>
      <div ref={gridRef} role="group" aria-label={label} className="grid overflow-hidden rounded-md border border-border bg-card" style={columns}>
        {/* header row */}
        <div className="border-b border-border bg-[var(--surface-alt)]" style={{ gridColumn: 1, gridRow: 1 }} />
        {closed.map((reason, day) => (
          <div
            key={`h${day}`}
            className={cn("grid place-items-center border-b border-l border-border px-0.5 text-center text-xs leading-[1.25] text-[var(--muted)]", compact ? "min-h-7" : "min-h-[42px]", !reason && "bg-[var(--surface-alt)]")}
            style={{ gridColumn: day + 2, gridRow: 1, ...(reason ? STRIPE : {}) }}
            title={reason ?? undefined}
          >
            <span>
              <b className="block font-semibold text-[var(--ink)]">{compact ? day + 1 : `Day ${day + 1}`}</b>
              {!compact && dayLabel(startDate, day)}
            </span>
          </div>
        ))}
        {/* band rows: labels and cells */}
        {BANDS.map((band) => (
          <div key={`l${band}`} className="flex items-center border-b border-border bg-[var(--surface-alt)] px-2.5 text-xs leading-[1.25] text-[var(--muted)]" style={{ gridColumn: 1, gridRow: rowOf(band) }}>
            <span>
              <b className="block font-semibold text-[var(--ink)]">{BAND_LABEL[band].name}</b>
              {outsideBand?.[band] ?? (compact ? null : BAND_LABEL[band].hours)}
            </span>
          </div>
        ))}
        {BANDS.flatMap((band) =>
          closed.map((reason, day) => (
            <div
              key={`c${band}${day}`}
              data-cell=""
              data-day={day}
              data-band={band}
              className={cn("grid place-items-center border-b border-l border-border", compact ? "min-h-[40px]" : "min-h-[58px]")}
              style={{ gridColumn: day + 2, gridRow: rowOf(band), ...(reason ? STRIPE : outsideBand?.[band] ? PART_STRIPE : {}) }}
            >
              {reason && band === "afternoon" && !byCell.has(`${day}|${band}`) && !ghosts.some((call) => call.wanted?.day === day && call.wanted.band === band) && (
                <span className="text-xs text-[var(--muted)]">{compact ? reason.slice(0, 3) : reason}</span>
              )}
            </div>
          )),
        )}
        {/* where the rule wanted a moved call */}
        {ghosts.map((call) => (
          <span
            key={`g${call.n}`}
            aria-hidden="true"
            title={`Call ${call.n} was due here: ${call.movedBecause}`}
            className={cn(dotClass("ghost", compact ? "sm" : "md"), "pointer-events-none self-center justify-self-center")}
            style={{ gridColumn: (call.wanted?.day ?? 0) + 2, gridRow: rowOf(call.wanted?.band ?? "morning") }}
          >
            {call.n}
          </span>
        ))}
        {/* a drag in progress: where the dot will land */}
        {target && (
          <span
            aria-hidden="true"
            className={cn(dotClass("ghost", compact ? "sm" : "md"), "pointer-events-none self-center justify-self-center border-[var(--ring-color)]")}
            style={{ gridColumn: target.day + 2, gridRow: rowOf(target.band) }}
          />
        )}
        {/* the calls, in call order */}
        {cellKeys.map((key) => {
          const [day, band] = key.split("|") as [string, Band];
          return (
            <div key={key} data-cell="" data-day={day} data-band={band} className="pointer-events-none flex items-center justify-center gap-0.5 self-center justify-self-center" style={{ gridColumn: Number(day) + 2, gridRow: rowOf(band) }}>
              {(byCell.get(key) ?? []).map((call) => {
                const look = call.moved ? "moved" : ownCalls?.has(call.n) ? "own" : "call";
                const draggable = editable && call.n !== 1;
                const name = `Call ${call.n}${call.moved ? `, moved: wanted ${dayLabel(startDate, call.wanted?.day ?? call.day)}, ${call.movedBecause}` : ""}`;
                const dot = (
                  <button
                    type="button"
                    data-call={call.n}
                    aria-label={name}
                    className={cn(
                      dotClass(look, compact ? "sm" : "md", openCall === call.n),
                      "pointer-events-auto outline-none focus-visible:shadow-[0_0_0_3px_var(--surface),0_0_0_5px_var(--ring-color)]",
                      draggable ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer",
                    )}
                    onPointerDown={(event) => onPointerDown(event, call)}
                    onPointerMove={onPointerMove}
                    onPointerUp={(event) => onPointerUp(event, call)}
                    onPointerCancel={() => { drag.current = null; setTarget(null); }}
                    onKeyDown={(event) => onKeyDown(event, call)}
                    onClick={(event) => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        event.preventDefault();
                      }
                    }}
                  >
                    {call.n}
                    {tip(call) && (
                      <span role="tooltip" className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--ink)] px-2 py-1 text-xs font-medium text-[var(--surface)]">
                        {tip(call)}
                      </span>
                    )}
                  </button>
                );
                if (!renderPopover || !onOpenCall) return <span key={call.n}>{dot}</span>;
                return (
                  <Popover key={call.n} open={openCall === call.n} onOpenChange={(open) => onOpenCall(open ? call.n : null)}>
                    <PopoverTrigger asChild>{dot}</PopoverTrigger>
                    <PopoverContent side="right" align="start" sideOffset={12} className="w-[330px] p-0">
                      {renderPopover(call.n)}
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
          );
        })}
        {/* the wait row */}
        {!compact && (
          <>
            <div className="flex min-h-[34px] items-center bg-[var(--surface-alt)] px-2.5 text-xs font-semibold text-[var(--ink)]" style={{ gridColumn: 1, gridRow: 5 }}>Wait</div>
            {closed.map((_, day) => (
              <div key={`w${day}`} className="grid min-h-[34px] place-items-center border-l border-border px-0.5 text-center text-xs leading-[1.2] text-[var(--muted)]" style={{ gridColumn: day + 2, gridRow: 5 }}>
                <span>
                  {calls.filter((call) => call.day === day).map((call) => (
                    <span key={call.n} className="block">{call.moved ? `→ ${dayLabel(startDate, day).split(" ")[0]}` : shortWait(call.delayInterval)}</span>
                  ))}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
      {later > 0 && <p className="m-0 mt-2 text-xs text-[var(--muted)]">{later} more {later === 1 ? "call comes" : "calls come"} after day {days}; the list beside the timeline shows {later === 1 ? "it" : "them"}.</p>}
    </div>
  );
}

/** The legend under the timeline. */
export function TimelineLegend({ hasMoved, link }: { hasMoved: boolean; link?: ReactNode }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
      <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="inline-block size-4 rounded-full bg-[var(--primary)]" />Call</span>
      <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="inline-block size-4 rounded-full bg-[var(--info-surface)]" />This outcome&apos;s own rule</span>
      {hasMoved && <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="inline-block size-4 rounded-full bg-[var(--primary)] shadow-[0_0_0_2px_var(--warning)]" />Moved by calling windows</span>}
      {hasMoved && <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="inline-block size-4 rounded-full border-[1.5px] border-dashed border-[var(--border-strong)]" />Where the rule wanted it</span>}
      <span className="inline-flex items-center gap-1.5"><i aria-hidden="true" className="inline-block size-4 rounded-[4px] border border-border" style={STRIPE} />No calls</span>
      {link}
    </div>
  );
}

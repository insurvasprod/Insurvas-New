"use client";

/**
 * Settings › Inbound settings (round 8) — the waiting ladder as a timeline (board screens 6–8).
 *
 * A transfer starts at 0; each rung fires once if nobody has claimed it. Drag a knob (the time follows
 * it, snapped), press − / +, or click a rung for chips and a stepper. A rung never passes its neighbour:
 * it stops 15 s short and the line under the ladder says why. Nothing is typed.
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent } from "@/components/ui/popover";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { LadderValues } from "@/lib/queueSla/ladder";
import {
  RUNGS,
  RUNG_LABEL,
  chipTimes,
  durationLabel,
  ladderScale,
  placeRung,
  rungLimits,
  stepFor,
  stepRung,
  stoppedSentence,
  type LadderScale,
  type Rung,
} from "@/lib/queueSla/scale";
import { cn } from "@/lib/utils";

/** − value +, the board's `.stp`. The value is shown, never typed. */
export function DurationStepper({
  label,
  value,
  onStep,
  canDown,
  canUp,
  disabled,
  invalid,
  format = durationLabel,
}: {
  label: string;
  value: number;
  onStep: (direction: 1 | -1) => void;
  canDown: boolean;
  canUp: boolean;
  disabled?: boolean;
  invalid?: boolean;
  format?: (value: number) => string;
}) {
  return (
    <span className={cn("inline-flex h-[30px] shrink-0 items-center overflow-hidden rounded-md border bg-card text-xs font-semibold whitespace-nowrap text-[var(--ink)]", invalid ? "border-[var(--error-ink)]" : "border-border")}>
      <Button type="button" variant="ghost" size="icon-xs" className="h-full w-[26px] rounded-none text-[var(--muted)]" aria-label={`Earlier: ${label}`} disabled={disabled || !canDown} onClick={() => onStep(-1)}>
        <Minus aria-hidden="true" />
      </Button>
      <span aria-live="polite" className="min-w-14 border-x border-border px-1.5 text-center leading-7 tabular-nums">{format(value)}</span>
      <Button type="button" variant="ghost" size="icon-xs" className="h-full w-[26px] rounded-none text-[var(--muted)]" aria-label={`Later: ${label}`} disabled={disabled || !canUp} onClick={() => onStep(1)}>
        <Plus aria-hidden="true" />
      </Button>
    </span>
  );
}

/** What each rung does, for its popover. */
export type RungEffects = Record<Rung, string>;

const STEPPER_PX = 132;

export function Ladder({
  values,
  editable,
  onChange,
  effects,
  label,
}: {
  values: LadderValues;
  editable: boolean;
  onChange: (next: LadderValues) => void;
  effects: RungEffects;
  label: string;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  const [drag, setDrag] = useState<{ rung: Rung; scale: LadderScale; moved: boolean } | null>(null);
  const [stopped, setStopped] = useState<{ rung: Rung; neighbour: Rung } | null>(null);
  const [open, setOpen] = useState<Rung | null>(null);
  const live = ladderScale(values);
  const scale = drag?.scale ?? live;

  useEffect(() => {
    const element = track.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Two rungs closer than a stepper's width take turns above and below, so nothing overlaps.
  const levels: Record<Rung, 0 | 1> = { warn: 0, escalate: 0, partner: 0, expire: 0 };
  let lastLow = -Infinity;
  for (const rung of RUNGS) {
    const x = scale.at(values[rung]) * width;
    if (x - lastLow < STEPPER_PX) levels[rung] = 1;
    else lastLow = x;
  }

  function place(rung: Rung, seconds: number) {
    const placed = placeRung(values, rung, seconds);
    setStopped(placed.stopped ? { rung, neighbour: placed.stopped } : null);
    if (placed.value !== values[rung]) onChange({ ...values, [rung]: placed.value });
  }

  function step(rung: Rung, direction: 1 | -1) {
    const next = stepRung(values, rung, direction);
    const { min, max } = rungLimits(values, rung);
    const index = RUNGS.indexOf(rung);
    const neighbour = direction === 1 ? RUNGS[index + 1] : RUNGS[index - 1];
    setStopped(next === values[rung] && neighbour && (direction === 1 ? next >= max : next <= min) ? { rung, neighbour } : null);
    if (next !== values[rung]) onChange({ ...values, [rung]: next });
  }

  function down(event: PointerEvent<HTMLButtonElement>, rung: Rung) {
    if (!editable || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ rung, scale: live, moved: false });
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    if (!drag || !track.current) return;
    const rect = track.current.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setDrag({ ...drag, moved: true });
    place(drag.rung, drag.scale.seconds(fraction));
  }

  function up(rung: Rung) {
    if (drag && !drag.moved) setOpen(rung);
    setDrag(null);
  }

  function key(event: KeyboardEvent<HTMLButtonElement>, rung: Rung) {
    if (!editable) return;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); step(rung, 1); }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); step(rung, -1); }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(rung); }
  }

  const fill = scale.at(values.expire) * 100;

  return (
    <div>
      <div role="group" aria-label={label} className="relative mt-1.5 mr-12 ml-7 h-[168px]" ref={track}>
        <div aria-hidden="true" className="absolute inset-x-0 top-[46px] h-2 rounded-full bg-[var(--surface-alt)] shadow-[inset_0_0_0_1px_var(--border)]" />
        <div aria-hidden="true" className="absolute top-[46px] left-0 h-2 rounded-full bg-[var(--primary)]" style={{ width: `${fill}%`, opacity: 0.9 }} />
        {scale.ticks.map((tick) => (
          <span key={tick} aria-hidden="true">
            <i className="absolute top-[58px] h-1.5 w-px bg-[var(--border-strong)]" style={{ left: `${scale.at(tick) * 100}%` }} />
            <span className="absolute top-[146px] -translate-x-1/2 text-xs whitespace-nowrap text-[var(--muted)]" style={{ left: `${scale.at(tick) * 100}%` }}>{durationLabel(tick)}</span>
          </span>
        ))}
        {RUNGS.map((rung) => {
          const at = scale.at(values[rung]) * 100;
          const level = levels[rung];
          const dragging = drag?.rung === rung;
          const bad = stopped?.rung === rung;
          const { min, max } = rungLimits(values, rung);
          return (
            <Popover key={rung} open={open === rung} onOpenChange={(next) => setOpen(next ? rung : null)}>
              <div className="absolute top-0 z-[2] -translate-x-1/2" style={{ left: `${at}%` }}>
                <b className={cn("absolute left-1/2 -translate-x-1/2 text-xs font-semibold whitespace-nowrap text-[var(--ink)]", level ? "top-0" : "top-5")}>{RUNG_LABEL[rung]}</b>
                <PopoverAnchor asChild>
                  <button
                    type="button"
                    role="slider"
                    aria-label={`${RUNG_LABEL[rung]} after`}
                    aria-valuemin={min}
                    aria-valuemax={max}
                    aria-valuenow={values[rung]}
                    aria-valuetext={durationLabel(values[rung])}
                    disabled={!editable}
                    onPointerDown={(event) => down(event, rung)}
                    onPointerMove={move}
                    onPointerUp={() => up(rung)}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(event) => key(event, rung)}
                    className={cn(
                      "absolute top-10 left-1/2 size-5 -translate-x-1/2 touch-none rounded-full border-[3px] bg-card shadow-[var(--shadow-rest)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2",
                      rung === "expire" || bad ? "border-[var(--error)]" : "border-[var(--primary)]",
                      editable ? "cursor-grab active:cursor-grabbing" : "cursor-default",
                      (dragging || open === rung) && "ring-[6px] ring-[var(--primary-soft)]",
                    )}
                  />
                </PopoverAnchor>
                <span className={cn("absolute left-1/2 -translate-x-1/2", level ? "top-[106px]" : "top-[70px]")}>
                  {dragging && drag?.moved ? (
                    <span className="inline-block rounded-md bg-[var(--ink)] px-2 py-1 text-xs font-semibold whitespace-nowrap text-[var(--surface)]">{durationLabel(values[rung])}</span>
                  ) : (
                    <DurationStepper label={RUNG_LABEL[rung]} value={values[rung]} disabled={!editable} invalid={bad} canDown={values[rung] > min} canUp={values[rung] < max} onStep={(direction) => step(rung, direction)} />
                  )}
                </span>
              </div>
              <PopoverContent side="bottom" align="center" className="w-80 p-4">
                <PopoverArrow className="fill-[var(--surface)]" />
                <RungEditor values={values} rung={rung} effect={effects[rung]} onCancel={() => setOpen(null)} onUse={(seconds) => { place(rung, seconds); setOpen(null); }} />
              </PopoverContent>
            </Popover>
          );
        })}
      </div>
      {stopped && <p role="alert" className="m-0 mt-1 text-xs text-[var(--error-ink)]">{stoppedSentence(values, stopped.rung, stopped.neighbour)}</p>}
    </div>
  );
}

/** The rung's popover (board screen 7): chips for common times, a stepper, the limits from its neighbours. */
function RungEditor({ values, rung, effect, onCancel, onUse }: { values: LadderValues; rung: Rung; effect: string; onCancel: () => void; onUse: (seconds: number) => void }) {
  const [value, setValue] = useState(values[rung]);
  const local = { ...values, [rung]: value };
  const { min, max } = rungLimits(values, rung);
  const index = RUNGS.indexOf(rung);
  const before = index > 0 ? RUNGS[index - 1] : null;
  const after = index < RUNGS.length - 1 ? RUNGS[index + 1] : null;
  const step = stepFor(value);
  const limits = before && after
    ? `Between ${RUNG_LABEL[before]} (${durationLabel(values[before])}) and ${RUNG_LABEL[after]} (${durationLabel(values[after])}).`
    : after
      ? `At least 15 s, and before ${RUNG_LABEL[after]} (${durationLabel(values[after])}).`
      : before
        ? `After ${RUNG_LABEL[before]} (${durationLabel(values[before])}), within 7 days.`
        : "";
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h4 className="m-0 text-sm font-semibold text-[var(--ink)]">{RUNG_LABEL[rung]} after</h4>
        <p className="m-0 text-xs text-[var(--muted)]">{effect}</p>
      </div>
      <div role="radiogroup" aria-label={`Common times for ${RUNG_LABEL[rung]}`} className="flex flex-wrap gap-1.5">
        {chipTimes(values, rung).map((chip) => (
          <ToggleChip key={chip.seconds} role="radio" selected={chip.seconds === value} disabled={!chip.allowed} onClick={() => setValue(chip.seconds)} className="h-8 px-2.5 text-xs">
            {durationLabel(chip.seconds)}
          </ToggleChip>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <DurationStepper
          label={RUNG_LABEL[rung]}
          value={value}
          canDown={value > min}
          canUp={value < max}
          onStep={(direction) => setValue(stepRung(local, rung, direction))}
        />
        <span className="text-xs text-[var(--muted)]">{step === 15 ? "15-second steps" : `${durationLabel(step)} steps`}</span>
      </div>
      <p className="m-0 text-xs text-[var(--muted)]">{limits}</p>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="button" size="sm" disabled={value < min || value > max} onClick={() => onUse(value)}>Use {durationLabel(value)}</Button>
      </div>
    </div>
  );
}

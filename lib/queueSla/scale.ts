/**
 * Settings › Inbound settings, round 8 — the waiting ladder as a timeline you drag. Pure, no
 * `server-only`: the screen imports it.
 *
 * The four rungs are seconds (tenant_queue_sla_settings). The board draws them on a straight 0–6 min
 * line; real ladders run from 45 seconds to several hours, where a straight line would pile three
 * knobs on top of each other. So the line is straight while every rung has room, and logarithmic
 * once it would not (`ladderScale`). Durations are never typed: they step, snap and come from chips.
 */

import type { LadderValues } from "./ladder.ts";

export const RUNGS = ["warn", "escalate", "partner", "expire"] as const;
export type Rung = (typeof RUNGS)[number];
export const RUNG_LABEL: Record<Rung, string> = { warn: "Warn", escalate: "Escalate", partner: "Partner notice", expire: "Expire" };

/** The database refuses anything past seven days (update_tenant_queue_sla_settings). */
export const MAX_SECONDS = 604_800;
/** Two rungs never closer than this. */
export const MIN_GAP_SECONDS = 15;

/** `45 s`, `1 min 30 s`, `3 min`, `4 h`, `1 h 30 min`, `2 d`. */
export function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s === 0) return "0";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const parts = [d ? `${d} d` : "", h ? `${h} h` : "", m ? `${m} min` : "", r ? `${r} s` : ""].filter(Boolean);
  return parts.slice(0, 2).join(" ");
}

/** How far one press of − or + moves a rung at this value: quarter minutes early on, coarser later. */
export function stepFor(seconds: number): number {
  if (seconds < 5 * 60) return 15;
  if (seconds < 60 * 60) return 60;
  if (seconds < 24 * 3600) return 15 * 60;
  return 3600;
}

export function snapSeconds(seconds: number): number {
  const step = stepFor(seconds);
  return Math.max(step, Math.round(seconds / step) * step);
}

/** The lowest and highest a rung may go, given its neighbours. */
export function rungLimits(values: LadderValues, rung: Rung): { min: number; max: number } {
  const index = RUNGS.indexOf(rung);
  const before = index === 0 ? 0 : values[RUNGS[index - 1]];
  const after = index === RUNGS.length - 1 ? MAX_SECONDS + MIN_GAP_SECONDS : values[RUNGS[index + 1]];
  return { min: Math.max(MIN_GAP_SECONDS, before + MIN_GAP_SECONDS), max: Math.min(MAX_SECONDS, after - MIN_GAP_SECONDS) };
}

/** One press of − or +, held inside the neighbours. */
export function stepRung(values: LadderValues, rung: Rung, direction: 1 | -1): number {
  const value = values[rung];
  const step = stepFor(direction === 1 ? value : Math.max(1, value - 1));
  const next = direction === 1 ? Math.floor(value / step) * step + step : Math.ceil(value / step) * step - step;
  const { min, max } = rungLimits(values, rung);
  return Math.min(max, Math.max(min, next));
}

/**
 * Where a rung was asked to go, held inside its neighbours. `stopped` names the neighbour it ran into,
 * so the screen can say why it stopped (board screen 8).
 */
export function placeRung(values: LadderValues, rung: Rung, seconds: number): { value: number; stopped: Rung | null } {
  const { min, max } = rungLimits(values, rung);
  const snapped = snapSeconds(seconds);
  const index = RUNGS.indexOf(rung);
  if (snapped < min) return { value: min, stopped: index === 0 ? null : RUNGS[index - 1] };
  if (snapped > max) return { value: max, stopped: index === RUNGS.length - 1 ? null : RUNGS[index + 1] };
  return { value: snapped, stopped: null };
}

/** The sentence under a rung that stopped at a neighbour. */
export function stoppedSentence(values: LadderValues, rung: Rung, neighbour: Rung): string {
  const before = RUNGS.indexOf(neighbour) > RUNGS.indexOf(rung);
  return `${RUNG_LABEL[rung]} has to come at least ${MIN_GAP_SECONDS} s ${before ? "before" : "after"} ${RUNG_LABEL[neighbour]} (${durationLabel(values[neighbour])}).`;
}

/** The common times offered as chips: a ladder of round values around where the rung is now. */
const CHIP_TIMES = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400, 172800, 604800];

export function chipTimes(values: LadderValues, rung: Rung): Array<{ seconds: number; allowed: boolean }> {
  const { min, max } = rungLimits(values, rung);
  const value = values[rung];
  const sorted = [...new Set([...CHIP_TIMES, value])].sort((a, b) => a - b);
  const at = sorted.indexOf(value);
  const from = Math.max(0, Math.min(at - 2, sorted.length - 5));
  return sorted.slice(from, from + 5).map((seconds) => ({ seconds, allowed: seconds >= min && seconds <= max }));
}

const AXIS_ENDS = [60, 120, 180, 240, 300, 360, 480, 600, 900, 1200, 1800, 2700, 3600, 7200, 10800, 14400, 21600, 28800, 43200, 86400, 172800, 259200, 432000, 604800, 691200];
const LOG_TICKS = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800, 86400, 172800, 604800];

export type LadderScale = {
  kind: "linear" | "log";
  /** The axis' right end, in seconds. */
  max: number;
  /** 0–1 along the axis. */
  at: (seconds: number) => number;
  /** The inverse, for a drag. */
  seconds: (fraction: number) => number;
  ticks: number[];
};

/**
 * A straight axis a fifth longer than Expire (the board's 0–6 min for a 5 min ladder), unless two
 * rungs would sit within 7% of each other; then a log axis, so 45 s and 4 h both have room.
 */
export function ladderScale(values: LadderValues): LadderScale {
  const max = AXIS_ENDS.find((end) => end >= values.expire * 1.15) ?? values.expire * 1.2;
  const points = [0, ...RUNGS.map((rung) => values[rung] / max)];
  const crowded = points.some((point, index) => index > 0 && point - points[index - 1] < 0.07);
  if (!crowded) {
    const step = max / 6;
    return { kind: "linear", max, at: (s) => Math.min(1, Math.max(0, s / max)), seconds: (f) => f * max, ticks: Array.from({ length: 7 }, (_, i) => Math.round(i * step)) };
  }
  const top = Math.log1p(max);
  const at = (s: number) => Math.min(1, Math.max(0, Math.log1p(Math.max(0, s)) / top));
  const ticks = [0];
  for (const tick of LOG_TICKS) if (tick <= max && at(tick) - at(ticks[ticks.length - 1]) >= 0.08) ticks.push(tick);
  if (at(max) - at(ticks[ticks.length - 1]) >= 0.08) ticks.push(max);
  return { kind: "log", max, at, seconds: (f) => Math.expm1(f * top), ticks };
}

/** How many rungs differ between two ladders. */
export function ladderChanges(before: LadderValues, after: LadderValues): Array<{ rung: Rung; from: number; to: number }> {
  return RUNGS.filter((rung) => before[rung] !== after[rung]).map((rung) => ({ rung, from: before[rung], to: after[rung] }));
}

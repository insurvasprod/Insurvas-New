/**
 * LA-5.11 (Notion sprint) · the retention settings hub, as plain rules: every number LA-5 reads, its
 * column, its limits (the same ones the database checks), the platform default a section resets to,
 * and what a change looks like in the audit trail.
 *
 * Caps are not settings. The holdout ceiling, the win-back affordability floor and the day-28 draft
 * cap are platform-side (PLATFORM_CAPS): shown, never editable here.
 *
 * Pure; relative imports only.
 */

import { ASSIGNMENT_STRATEGIES, BANDS, PLATFORM_CAPS, PLATFORM_DEFAULT_SETTINGS, PLATFORM_DEFAULT_WEIGHTS, QUEUE_DEFAULT_SORTS, SIGNALS, WINBACK_REASONS, type Band, type RetentionSettings, type Weights, type WinbackReason } from "./constants.ts";

export const HUB_SECTIONS = ["weights", "thresholds", "queue", "signals", "campaigns", "servicing", "reinstatement", "winback", "holdout", "assignment"] as const;
export type HubSection = (typeof HUB_SECTIONS)[number];
export const HUB_SECTION_LABELS: Record<HubSection, string> = {
  weights: "Scoring weights",
  thresholds: "Band thresholds",
  queue: "Queue behaviour",
  signals: "Signal settings",
  campaigns: "Campaigns",
  servicing: "Servicing",
  reinstatement: "Reinstatement",
  winback: "Win-back",
  holdout: "Holdout",
  assignment: "Roles and assignment",
};

/** Scalar settings: key → column, section and limits. Winback days are flattened below. */
type Scalar = Exclude<keyof RetentionSettings, "winbackDays" | "assignmentCarrierReps" | "assignmentRepOrder">;
type Spec = { column: string; section: HubSection; min?: number; max?: number; kind: "int" | "bool" | "enum" | "text"; options?: readonly string[] };

export const FIELDS: Record<Scalar, Spec> = {
  mediumFrom: { column: "medium_from", section: "thresholds", kind: "int", min: 1, max: 98 },
  highFrom: { column: "high_from", section: "thresholds", kind: "int", min: 2, max: 98 },
  criticalFrom: { column: "critical_from", section: "thresholds", kind: "int", min: 3, max: 99 },
  queueMinBand: { column: "queue_min_band", section: "thresholds", kind: "enum", options: ["medium", "high", "critical"] },
  workedCooldownDays: { column: "worked_cooldown_days", section: "queue", kind: "int", min: 0, max: 365 },
  maxCards: { column: "max_cards", section: "queue", kind: "int", min: 10, max: 500 },
  queueDefaultSort: { column: "queue_default_sort", section: "queue", kind: "enum", options: QUEUE_DEFAULT_SORTS },
  includeMediumWhenEmpty: { column: "include_medium_when_empty", section: "queue", kind: "bool" },
  sampleFloor: { column: "sample_floor", section: "signals", kind: "int", min: 5, max: 500 },
  carrierSampleFloor: { column: "carrier_sample_floor", section: "signals", kind: "int", min: 5, max: 500 },
  dangerMonthFrom: { column: "danger_month_from", section: "signals", kind: "int", min: 1, max: 24 },
  dangerMonthTo: { column: "danger_month_to", section: "signals", kind: "int", min: 1, max: 24 },
  affordabilityLowBp: { column: "affordability_low_bp", section: "signals", kind: "int", min: 1, max: 5000 },
  affordabilityHighBp: { column: "affordability_high_bp", section: "signals", kind: "int", min: 2, max: 10000 },
  billDeclineCooloffDays: { column: "bill_decline_cooloff_days", section: "campaigns", kind: "int", min: 30, max: 730 },
  billTalkTrack: { column: "bill_talk_track", section: "campaigns", kind: "text" },
  servicingGraceDays: { column: "servicing_grace_days", section: "servicing", kind: "int", min: 0, max: 90 },
  reinstatementAmberDays: { column: "reinstatement_amber_days", section: "reinstatement", kind: "int", min: 3, max: 90 },
  reinstatementRedDays: { column: "reinstatement_red_days", section: "reinstatement", kind: "int", min: 2, max: 89 },
  reinstatementPinDays: { column: "reinstatement_pin_days", section: "reinstatement", kind: "int", min: 1, max: 30 },
  reinstatementEscalateDays: { column: "reinstatement_escalate_days", section: "reinstatement", kind: "int", min: 1, max: 30 },
  holdoutEnabled: { column: "holdout_enabled", section: "holdout", kind: "bool" },
  holdoutShareBp: { column: "holdout_share_bp", section: "holdout", kind: "int", min: 100, max: PLATFORM_CAPS.holdoutCeilingBp },
  holdoutMaxExposureCents: { column: "holdout_max_exposure_cents", section: "holdout", kind: "int", min: 0, max: 100_000_000 },
  predictionHorizonDays: { column: "prediction_horizon_days", section: "holdout", kind: "int", min: 30, max: 365 },
  assignmentStrategy: { column: "assignment_strategy", section: "assignment", kind: "enum", options: ASSIGNMENT_STRATEGIES },
};

/** Win-back cooling-off limits per reason, as the database checks them. Affordability's minimum is the platform floor. */
export const WINBACK_LIMITS: Record<WinbackReason, { min: number; max: number }> = {
  mechanical: { min: 7, max: 365 },
  administrative: { min: 7, max: 365 },
  unknown: { min: 30, max: 730 },
  carrier_declined: { min: 30, max: 730 },
  affordability: { min: PLATFORM_CAPS.winbackAffordabilityFloorDays, max: 1095 },
  no_longer_wanted: { min: 90, max: 1095 },
};
export const WINBACK_LABELS: Record<WinbackReason, string> = {
  mechanical: "A payment failed; never said no",
  administrative: "Card expired, bank closed or moved",
  unknown: "Just stopped, no reason given",
  carrier_declined: "The carrier declined reinstatement",
  affordability: "Said they could not afford it",
  no_longer_wanted: "Said they no longer wanted it",
};

/** The words that must be typed to shorten the affordability cooling-off. Awkward on purpose. */
export const AFFORDABILITY_CONFIRMATION = "SHORTEN";

/**
 * Shown above the holdout switch, before it can be turned on. Describes what the code does; it is not
 * a preference and is not editable.
 */
export const HOLDOUT_EXPLANATION = [
  "When the holdout is on, a small random share of the policies that cross into the save queue is held back: those policies are not shown on the queue and nobody calls them about the risk.",
  "After the horizon we compare what happened to them with the policies that were worked in the same band. Without that comparison nobody can tell \"the radar saved 40 policies\" from \"40 policies were fine all along\".",
  "Safeguards: a held-back policy that falls past due leaves the holdout in the next radar run and goes on the Lapse risk board like any other. A policy with more advance at risk than your threshold, or with an unknown advance, is never held back. Reinstatement cases are never held back. The share can never be more than 20%. Held-back policies count against nobody's scorecard. You can switch it off at any time; held-back policies then return to the queue.",
] as const;

export type Change = { setting: string; from: unknown; to: unknown };

const WINBACK_COLUMN = (r: WinbackReason) => `winback_${r}_days`;

/** Every column the hub owns, from the settings. */
export function toRow(s: RetentionSettings): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(FIELDS) as Scalar[]) row[FIELDS[key].column] = s[key];
  for (const r of WINBACK_REASONS) row[WINBACK_COLUMN(r)] = s.winbackDays[r];
  row.assignment_carrier_reps = s.assignmentCarrierReps;
  row.assignment_rep_order = s.assignmentRepOrder;
  return row;
}

/** One audit row per column that changed. */
export function diff(before: RetentionSettings, after: RetentionSettings): Change[] {
  const a = toRow(before);
  const b = toRow(after);
  return Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => ({ setting: k, from: a[k] ?? null, to: b[k] ?? null }));
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The first problem with these settings, in words — the database's checks, said before it says them. */
export function validate(s: RetentionSettings): string | null {
  for (const key of Object.keys(FIELDS) as Scalar[]) {
    const spec = FIELDS[key];
    const v = s[key] as unknown;
    if (spec.kind === "int" && (!Number.isInteger(v) || (v as number) < spec.min! || (v as number) > spec.max!)) return `${key} must be a whole number from ${spec.min} to ${spec.max}.`;
    if (spec.kind === "bool" && typeof v !== "boolean") return `${key} must be on or off.`;
    if (spec.kind === "enum" && !spec.options!.includes(v as string)) return `${key} is not one of the choices.`;
  }
  if (!(s.highFrom > s.mediumFrom && s.criticalFrom > s.highFrom)) return "The bands must rise: medium below high, high below critical.";
  if (s.dangerMonthTo < s.dangerMonthFrom) return "The danger window must end on or after it starts.";
  if (s.affordabilityHighBp <= s.affordabilityLowBp) return "The high affordability band must start above the low one.";
  if (!(s.reinstatementRedDays > s.reinstatementPinDays && s.reinstatementAmberDays > s.reinstatementRedDays)) return "The reinstatement countdown must step down: amber, then red, then pinned.";
  if (s.billTalkTrack !== null && (s.billTalkTrack.trim().length < 10 || s.billTalkTrack.length > 4000)) return "The talk track must be 10 to 4,000 characters, or left to the platform's.";
  for (const r of WINBACK_REASONS) {
    const d = s.winbackDays[r];
    const lim = WINBACK_LIMITS[r];
    if (!Number.isInteger(d) || d < lim.min || d > lim.max) return `${WINBACK_LABELS[r]}: the cooling-off must be from ${lim.min} to ${lim.max} days.`;
  }
  if (Object.entries(s.assignmentCarrierReps).some(([c, u]) => !isUuid(c) || typeof u !== "string" || !isUuid(u))) return "Each carrier must map to one person.";
  if (s.assignmentRepOrder.length > 200 || s.assignmentRepOrder.some((u) => !isUuid(u))) return "The rep order lists people by their id.";
  return null;
}

export type Guards = { confirmation?: string | null; holdoutAcknowledged?: boolean };

/** The two changes that need more than a click: shortening affordability's cooling-off, and switching the holdout on. */
export function guardProblem(before: RetentionSettings, after: RetentionSettings, guards: Guards): string | null {
  if (after.winbackDays.affordability < before.winbackDays.affordability && (guards.confirmation ?? "").trim() !== AFFORDABILITY_CONFIRMATION) {
    return `Shortening the cooling-off for someone who could not afford it needs a typed confirmation: type ${AFFORDABILITY_CONFIRMATION}.`;
  }
  if (after.holdoutEnabled && !before.holdoutEnabled && !guards.holdoutAcknowledged) return "Read what the holdout does before switching it on.";
  return null;
}

/** The section's platform values, applied over the current settings. */
export function resetSection(current: RetentionSettings, section: Exclude<HubSection, "weights">): RetentionSettings {
  const d = PLATFORM_DEFAULT_SETTINGS;
  const next: RetentionSettings = { ...current, winbackDays: { ...current.winbackDays } };
  for (const key of Object.keys(FIELDS) as Scalar[]) if (FIELDS[key].section === section) (next as Record<string, unknown>)[key] = d[key];
  if (section === "winback") next.winbackDays = { ...d.winbackDays };
  if (section === "assignment") {
    next.assignmentCarrierReps = {};
    next.assignmentRepOrder = [];
  }
  return next;
}

// ─── weights ─────────────────────────────────────────────────────────────────────────────────────

export const weightTotal = (w: Weights) => SIGNALS.reduce((sum, s) => sum + (w[s] ?? 0), 0);

/** A saveable weight set: whole numbers 0–100 that sum to 100 (a score's confidence is read against 100). */
export function weightProblem(w: Weights): string | null {
  for (const s of SIGNALS) if (!Number.isInteger(w[s]) || w[s] < 0 || w[s] > 100) return "Each weight is a whole number from 0 to 100.";
  const total = weightTotal(w);
  if (total !== 100) return `The weights add up to ${total}, not 100.`;
  return null;
}

export const sameWeights = (a: Weights, b: Weights) => SIGNALS.every((s) => a[s] === b[s]);
export const PLATFORM_WEIGHTS = PLATFORM_DEFAULT_WEIGHTS;

/** Band moves from current to previewed scores: counts per from→to, and the total that moved. */
export function bandMoves(before: Map<string, Band>, after: Map<string, Band>) {
  const moves: Record<string, number> = {};
  let moved = 0;
  let up = 0;
  for (const [key, to] of after) {
    const from = before.get(key);
    if (!from || from === to) continue;
    moved += 1;
    if (BANDS.indexOf(to) > BANDS.indexOf(from)) up += 1;
    moves[`${from}>${to}`] = (moves[`${from}>${to}`] ?? 0) + 1;
  }
  const into = (band: Band) => Object.entries(moves).filter(([k]) => k.endsWith(`>${band}`)).reduce((sum, [, n]) => sum + n, 0);
  return { moved, up, down: moved - up, moves, intoCritical: into("critical"), total: after.size };
}

// ─── live threshold consequences ─────────────────────────────────────────────────────────────────

/** Band counts and queue volume from score histograms (index = score 0–100), for thresholds not yet saved. */
export function thresholdConsequence(hist: { all: number[]; eligible: number[] }, s: Pick<RetentionSettings, "mediumFrom" | "highFrom" | "criticalFrom" | "queueMinBand" | "maxCards">) {
  const count = (h: number[], from: number, to: number) => h.slice(from, to).reduce((a, b) => a + b, 0);
  const bands = {
    low: count(hist.all, 0, s.mediumFrom),
    medium: count(hist.all, s.mediumFrom, s.highFrom),
    high: count(hist.all, s.highFrom, s.criticalFrom),
    critical: count(hist.all, s.criticalFrom, 101),
  };
  const from = s.queueMinBand === "critical" ? s.criticalFrom : s.queueMinBand === "high" ? s.highFrom : s.mediumFrom;
  const queue = count(hist.eligible, from, 101);
  return { bands, queue, shown: Math.min(queue, s.maxCards) };
}

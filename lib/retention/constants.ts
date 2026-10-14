/**
 * LA-5 (Notion sprint, Module 5 — Retention) · the names, labels and platform defaults the radar,
 * the save queue and their screens share. Client-safe: no I/O, no server-only.
 *
 * The weights and settings below are the PLATFORM DEFAULTS (LA-5.11 shows them read-only, with a
 * "Reset to defaults"). What a tenant actually scores with is read from risk_weight_set and
 * retention_settings; these are only the values a tenant starts on, and the migration seeds the same
 * numbers (a test keeps the two in step).
 */

/** The seven signs (LA-5.1), in the order the spec lists them. */
export const SIGNALS = ["draft_timing", "payment_method", "policy_age", "payment_wobble", "affordability", "lead_source", "carrier"] as const;
export type Signal = (typeof SIGNALS)[number];

/** Plain names, for settings and the "missing" list — never in the agent's sentence. */
export const SIGNAL_LABELS: Record<Signal, string> = {
  draft_timing: "Draft date vs income",
  payment_method: "How they pay",
  policy_age: "Months since issue",
  payment_wobble: "Bounced and retried payments",
  affordability: "Premium vs income",
  lead_source: "Lead source survival",
  carrier: "Carrier grace and redrafts",
};

/** What is missing, said the way an agent would ask for it. */
export const MISSING_LABELS: Record<Signal, string> = {
  draft_timing: "when their money arrives",
  payment_method: "how they pay",
  policy_age: "the issue date",
  payment_wobble: "a payment history",
  affordability: "their income",
  lead_source: "enough policies from this lead source",
  carrier: "the carrier's grace period",
};

export type Weights = Record<Signal, number>;

export const PLATFORM_DEFAULT_WEIGHTS: Weights = {
  draft_timing: 30,
  payment_method: 20,
  policy_age: 20,
  payment_wobble: 15,
  affordability: 10,
  lead_source: 3,
  carrier: 2,
};

export const BANDS = ["low", "medium", "high", "critical"] as const;
export type Band = (typeof BANDS)[number];
export const BAND_LABELS: Record<Band, string> = { low: "low", medium: "medium", high: "high", critical: "critical" };

export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export type RetentionSettings = {
  mediumFrom: number;
  highFrom: number;
  criticalFrom: number;
  queueMinBand: Exclude<Band, "low">;
  includeMediumWhenEmpty: boolean;
  workedCooldownDays: number;
  maxCards: number;
  sampleFloor: number;
  dangerMonthFrom: number;
  dangerMonthTo: number;
  affordabilityLowBp: number;
  affordabilityHighBp: number;
  /** LA-5.5: days a declined paper-bill conversion stays off the campaign. */
  billDeclineCooloffDays: number;
  /** LA-5.5: the agency's own talk track; null = the platform's (PLATFORM_TALK_TRACK). */
  billTalkTrack: string | null;
  /** LA-5.6: reinstatement countdown — amber, red, and pinned to the top (days before the deadline). */
  reinstatementAmberDays: number;
  reinstatementRedDays: number;
  reinstatementPinDays: number;
};

export const PLATFORM_DEFAULT_SETTINGS: RetentionSettings = {
  mediumFrom: 25,
  highFrom: 50,
  criticalFrom: 75,
  queueMinBand: "high",
  includeMediumWhenEmpty: false,
  workedCooldownDays: 30,
  maxCards: 100,
  sampleFloor: 20,
  dangerMonthFrom: 2,
  dangerMonthTo: 5,
  affordabilityLowBp: 300,
  affordabilityHighBp: 600,
  billDeclineCooloffDays: 180,
  billTalkTrack: null,
  reinstatementAmberDays: 14,
  reinstatementRedDays: 7,
  reinstatementPinDays: 3,
};

/** retention_settings row → settings; a missing row is the platform defaults. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function settingsFromRow(row: any | null | undefined): RetentionSettings {
  if (!row) return { ...PLATFORM_DEFAULT_SETTINGS };
  return {
    mediumFrom: row.medium_from,
    highFrom: row.high_from,
    criticalFrom: row.critical_from,
    queueMinBand: row.queue_min_band,
    includeMediumWhenEmpty: row.include_medium_when_empty,
    workedCooldownDays: row.worked_cooldown_days,
    maxCards: row.max_cards,
    sampleFloor: row.sample_floor,
    dangerMonthFrom: row.danger_month_from,
    dangerMonthTo: row.danger_month_to,
    affordabilityLowBp: row.affordability_low_bp,
    affordabilityHighBp: row.affordability_high_bp,
    billDeclineCooloffDays: row.bill_decline_cooloff_days ?? PLATFORM_DEFAULT_SETTINGS.billDeclineCooloffDays,
    billTalkTrack: row.bill_talk_track ?? null,
    reinstatementAmberDays: row.reinstatement_amber_days ?? PLATFORM_DEFAULT_SETTINGS.reinstatementAmberDays,
    reinstatementRedDays: row.reinstatement_red_days ?? PLATFORM_DEFAULT_SETTINGS.reinstatementRedDays,
    reinstatementPinDays: row.reinstatement_pin_days ?? PLATFORM_DEFAULT_SETTINGS.reinstatementPinDays,
  };
}

/** Policies the radar scores (LA-5.1 scope). Lapsed and paid-up go to LA-5.6 / 5.7 instead. */
export const SCORED_STATUSES = ["active", "at_risk", "approved_unpaid"] as const;

export const PAYMENT_METHODS = ["bank_draft", "direct_express", "card", "direct_bill"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** LA-5.3 · what the agent can do from a card, deterministic from the top signals. */
export const FIX_ACTIONS = ["move_draft_date", "convert_to_draft", "confirm_card_funded", "confirm_account", "review_coverage", "courtesy_call"] as const;
export type FixAction = (typeof FIX_ACTIONS)[number];

export const CONTACT_OUTCOMES = ["reached_agreed", "reached_refused", "voicemail", "wrong_number", "no_answer", "already_fixed"] as const;
export type ContactOutcome = (typeof CONTACT_OUTCOMES)[number];
export const CONTACT_OUTCOME_LABELS: Record<ContactOutcome, string> = {
  reached_agreed: "Reached, agreed to the fix",
  reached_refused: "Reached, said no",
  voicemail: "Left voicemail",
  wrong_number: "Wrong number",
  no_answer: "No answer",
  already_fixed: "Already fixed",
};

export const ACTION_TAKEN = ["none", ...FIX_ACTIONS] as const;
export type ActionTaken = (typeof ACTION_TAKEN)[number];

export const HOLD_KINDS = ["snooze", "dismiss"] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];
export const SNOOZE_DAYS = [7, 14, 30] as const;

export const RADAR_PENDING_MESSAGE = "The chargeback radar needs a database update (20261014100000).";

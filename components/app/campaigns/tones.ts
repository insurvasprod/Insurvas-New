/**
 * The colour a vendor or campaign figure is drawn in (owner 2026-10-28: "add more colors"): green
 * where it is good, amber worth a look, red bad. Display bands only — nothing is ranked, paused or
 * flagged by them; the ranked "best" and the drop facts still come from the server.
 */
export type FigureTone = "good" | "warning" | "danger" | null;

const INK = { good: "text-[var(--success-ink)]", warning: "text-[var(--warning-ink)]", danger: "text-[var(--error-ink)]" } as const;

/** The class for a coloured figure; nothing for an uncoloured one. */
export function toneText(tone: FigureTone) {
  return tone ? `font-semibold ${INK[tone]}` : undefined;
}

/**
 * Cheaper is better, against a reference: at or under it is green, over 1.5× it amber, over 2× red.
 * Per usable lead the reference is the agency's own cost per dialable lead (the headline tile); per
 * policy it is the cheapest ranked vendor.
 */
export function costTone(cents: number | null | undefined, reference: number | null | undefined): FigureTone {
  if (cents === null || cents === undefined || reference === null || reference === undefined || reference <= 0) return null;
  if (cents <= reference) return "good";
  if (cents > reference * 2) return "danger";
  if (cents > reference * 1.5) return "warning";
  return null;
}

/** A higher share is better (dialled under 60s, consent claimed, claims credited). */
export function highIsGood(pct: number | null | undefined, good: number, fair: number): FigureTone {
  if (pct === null || pct === undefined) return null;
  const value = Number(pct);
  return value >= good ? "good" : value >= fair ? "warning" : "danger";
}

/** A lower share is better (undialable, rejected at the scrub). */
export function lowIsGood(pct: number | null | undefined, good: number, fair: number): FigureTone {
  if (pct === null || pct === undefined) return null;
  const value = Number(pct);
  return value <= good ? "good" : value <= fair ? "warning" : "danger";
}

/** Median arrival to first dial: a minute is good, five is slow, more is lost. */
export function speedTone(seconds: number | null | undefined): FigureTone {
  if (seconds === null || seconds === undefined) return null;
  return seconds <= 60 ? "good" : seconds <= 300 ? "warning" : "danger";
}

/** Rows rejected at the scrub, as a share of rows bought. */
export function rejectedTone(rejected: number | null | undefined, purchased: number): FigureTone {
  if (rejected === null || rejected === undefined || purchased <= 0) return null;
  return lowIsGood((100 * rejected) / purchased, 2, 10);
}

/** What the colours mean, said once where a table uses them. */
export const TONE_KEY = "Green is good, amber is worth a look, red is bad. Per usable: at or under your average cost per dialable lead green, over 1.5× amber, over 2× red. Per policy: the cheapest ranked vendor green, over 1.5× it amber, over 2× red. Under 60s: 80%+ green, under 50% red. Consent: 90%+ green, under 50% red. Rejected: 2% or less green, over 10% red. Median to dial: a minute or less green, over five minutes red.";

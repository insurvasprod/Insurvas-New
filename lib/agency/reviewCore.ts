/**
 * AG-1.11 · Application Review, with no database (client-safe). Paperwork only — never "QA" on screen.
 */

export const REVIEW_ERROR_TYPES = ["wrong_form", "missing_field", "implausible_field", "draft_day_past_28", "payment_mismatch", "ss_date_mismatch", "bank_unverified", "other"] as const;
export type ReviewErrorType = (typeof REVIEW_ERROR_TYPES)[number];

export const REVIEW_ERROR_LABELS: Record<ReviewErrorType, string> = {
  wrong_form: "Wrong form for the carrier or product",
  missing_field: "Missing field",
  implausible_field: "Implausible field",
  draft_day_past_28: "Draft day past the 28th",
  payment_mismatch: "Payment method mismatch",
  ss_date_mismatch: "SS payment date vs birth day",
  bank_unverified: "Bank or routing number failed verification",
  other: "Other",
};

export const REVIEW_STATUS_LABELS = { queued: "To review", passed: "Passed", failed: "Failed", fix_requested: "Fix and resubmit" } as const;

/**
 * Whether an application is sampled at a rate (basis points). Deterministic from its id, so re-running the
 * sampler never samples twice and the rate is honoured exactly over many applications. Mirrors the database's
 * `abs(hashtextextended(id, 0)) % 10000 < rate` in spirit; this one is for tests and previews.
 */
export function sampled(applicationId: string, rateBps: number): boolean {
  let h = 2166136261;
  for (let i = 0; i < applicationId.length; i += 1) {
    h ^= applicationId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 10000 < rateBps;
}

/** The default rate: half for a producer in his first 90 days, a tenth after. */
export function defaultRateBps(hiredOn: string | null, today: string): number {
  if (!hiredOn) return 1000;
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${hiredOn}T00:00:00Z`)) / 86_400_000);
  return days < 90 ? 5000 : 1000;
}

/** The coachable tally: error type → count, per producer, most frequent first. */
export function errorTally(reviews: ReadonlyArray<{ producerUserId: string; errorTypes: readonly string[] }>): Map<string, Array<[string, number]>> {
  const byProducer = new Map<string, Map<string, number>>();
  for (const r of reviews) {
    const tally = byProducer.get(r.producerUserId) ?? new Map<string, number>();
    for (const type of r.errorTypes) tally.set(type, (tally.get(type) ?? 0) + 1);
    byProducer.set(r.producerUserId, tally);
  }
  return new Map([...byProducer].map(([producer, tally]) => [producer, [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))]));
}

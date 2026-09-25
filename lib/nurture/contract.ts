export const RECYCLABLE_DISPOSITIONS = ["no_answer", "voicemail", "not_interested"] as const;

/**
 * Plain module (no server-only imports): the page, the route and the loaders share these.
 *
 * The rules themselves are enforced in SQL (recycle_lead_candidates, 20260925706500); these numbers
 * are what the page says about them and what the route checks before it asks.
 */

/** "Not interested" is recyclable by an owner only, and only this long after the outcome. */
export const SAID_NO_MIN_DAYS = 90;
/** Dials a recycled lead gets on one pass unless the batch says otherwise. */
export const DEFAULT_PASS_CEILING = 3;
/** The cadence ceiling (schedule_next_attempt); a pass can be shorter, never longer. */
export const MAX_PASS_CEILING = 7;
export const ANGLE_MIN = 3;
export const ANGLE_MAX = 500;
export const SCRIPT_MAX = 5000;
/** A run with no progress for this long can be resumed by an owner. */
export const STALLED_MINUTES = 15;

export function normalizeRecycleRule(input: { waitDays: number; allowedDispositions: string[]; maxRecycles: number }) {
  if (!Number.isInteger(input.waitDays) || input.waitDays < 1 || input.waitDays > 3650) throw new Error("Wait days must be between 1 and 3,650");
  if (!Number.isInteger(input.maxRecycles) || input.maxRecycles < 0 || input.maxRecycles > 100) throw new Error("Recycle cap must be between 0 and 100");
  const allowedDispositions = [...new Set(input.allowedDispositions.map((item) => item.trim()).filter(Boolean))];
  if (!allowedDispositions.length || allowedDispositions.includes("do_not_call")) throw new Error("Choose at least one recyclable disposition; Do not call can never be recycled");
  return { waitDays: input.waitDays, allowedDispositions, maxRecycles: input.maxRecycles };
}

export function normalizeBatchInput(input: { angle: string; script?: string | null; attemptCeiling?: number | null }) {
  const angle = input.angle.trim();
  if (angle.length < ANGLE_MIN) throw new Error("Say what is different this time — the angle is required");
  if (angle.length > ANGLE_MAX) throw new Error(`Keep the angle under ${ANGLE_MAX} characters`);
  const script = (input.script ?? "").trim() || null;
  if (script && script.length > SCRIPT_MAX) throw new Error(`Keep the script under ${SCRIPT_MAX.toLocaleString("en-US")} characters`);
  const attemptCeiling = input.attemptCeiling ?? DEFAULT_PASS_CEILING;
  if (!Number.isInteger(attemptCeiling) || attemptCeiling < 1 || attemptCeiling > MAX_PASS_CEILING) throw new Error(`Attempts this pass must be between 1 and ${MAX_PASS_CEILING}`);
  return { angle, script, attemptCeiling };
}

/** Per campaign, what recycle_lead_candidates said about every worked lead (tenant_recycle_pool). */
export type RecyclePool = {
  exhaustedNoOutcome: number;
  saidNo: number;
  never: number;
  noPhone: number;
  resting: number;
  live: number;
  pending: number;
  beingWorked: number;
  capped: number;
  outcomeNotInRule: number;
  ownerOnly: number;
  tooRecent: number;
  eligible: number;
  eligibleSaidNo: number;
};

/** One past or running batch (tenant_recycle_batch_report). */
export type RecycleBatch = {
  id: string;
  campaignId: string;
  campaignName: string;
  angle: string;
  script: string | null;
  attemptCeiling: number;
  status: "screening" | "complete";
  createdAt: string;
  completedAt: string | null;
  lastProgressAt: string;
  stalled: boolean;
  createdBy: string | null;
  createdByName: string | null;
  queued: number;
  cleared: number;
  blocked: number;
  failed: number;
  pending: number;
  excludedTooRecent: number;
  saidNo: number;
  costCents: number;
  dials: number;
  contacts: number;
  leadsReached: number;
  policies: number;
  contactRate: number | null;
};

/** The pass a lead is on, as lead_recycle_context returns it — also what the dialer reads. */
export type RecycleContext = {
  batchId: string;
  angle: string;
  script: string | null;
  attemptCeiling: number;
  recycleNumber: number;
  recycledAt: string | null;
  current: boolean;
};

/** How a lead came to be in nurture, for the lead's Nurture tab. */
export type NurtureOrigin = "recycled" | "rested" | "expired_transfer" | "cadence" | null;

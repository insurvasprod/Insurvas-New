// Pure: the partner home's four counters, in the board's own vocabulary (lanes.ts).
//
// LA-1.17-4: the counters must agree with the board. They used to come from
// partner_lead_pipeline_page, which counts "converted" as a hard 0, "still open" as anything not
// completed or dropped (so expired submissions the board has closed), and "submitted today" by the
// database's UTC date while the tile says "since 00:00 your time". They are now read from the same
// lane figures the board draws:
//
//   Submitted today   submissions whose lead was created since 00:00 in the partner's timezone
//   Claimed           a closer holds it: the board's Claimed + Verification lanes ("In progress")
//   Converted         the board's Converted lane (a sale in the last 30 days)
//   Still open        the board's open lanes: New + Claimed + Verification
import { zonedParts } from "../format/dates.ts";
import type { PartnerLaneCounts } from "./lanes.ts";

export type PartnerHomeCounters = { submittedToday: number; claimed: number; converted: number; stillOpen: number };

export function countersFromLanes(lanes: PartnerLaneCounts, submittedToday: number): PartnerHomeCounters {
  return {
    submittedToday,
    claimed: lanes.claimed + lanes.verification,
    converted: lanes.converted,
    stillOpen: lanes.new + lanes.claimed + lanes.verification,
  };
}

/** partner_lead_pipeline_page's bucket width (20260929140000): 15 minutes of lead creation time. */
export const SUBMITTED_BUCKET_SECONDS = 900;
/** How far back the read model's buckets reach. A local day is at most 25 hours long. */
export const SUBMITTED_BUCKET_WINDOW_MS = 26 * 60 * 60 * 1000;

/**
 * "Submitted today" from the read model's `submitted_recent` buckets: [bucket, count] pairs where a
 * bucket is floor(epoch seconds / 900) of the lead's creation. Every zone's midnight is a multiple
 * of 15 minutes, so the buckets from `since` onward are exactly the leads created since then.
 * Null when the read model sent no buckets (an older one) or `since` cannot be answered from them;
 * the caller then counts with its own read.
 */
export function submittedSinceFromBuckets(buckets: unknown, since: Date, now: number = Date.now()): number | null {
  if (!Array.isArray(buckets)) return null;
  const sinceSeconds = since.getTime() / 1000;
  if (!Number.isInteger(sinceSeconds) || sinceSeconds % SUBMITTED_BUCKET_SECONDS !== 0) return null;
  if (now - since.getTime() > SUBMITTED_BUCKET_WINDOW_MS - SUBMITTED_BUCKET_SECONDS * 1000) return null;
  const first = sinceSeconds / SUBMITTED_BUCKET_SECONDS;
  let total = 0;
  for (const entry of buckets) {
    if (!Array.isArray(entry) || typeof entry[0] !== "number" || typeof entry[1] !== "number") return null;
    if (entry[0] >= first) total += entry[1];
  }
  return total;
}

/** The UTC instant of 00:00 today in `zone`. Two passes settle a DST boundary. Unknown zone: UTC. */
export function startOfTodayIn(zone: string, now: number = Date.now()): Date {
  const today = zonedParts(new Date(now), zone);
  if (!today) return new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()));
  const naive = Date.UTC(today.year, today.month - 1, today.day);
  let guess = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = zonedParts(new Date(guess), zone);
    if (!seen) break;
    guess += naive - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
  }
  return new Date(guess);
}

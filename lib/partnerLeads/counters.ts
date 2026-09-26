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

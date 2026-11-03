/**
 * "Preview the queue" on the scoring screen (concept board LA-2 §13): the shapes
 * scoring_queue_preview (migration 20260925701100) returns, and how the screen words them.
 *
 * Pure and free of `server-only`, so the workspace (a client component), the service and the tests
 * can all use it.
 */

export type PreviewRow = {
  position: number;
  workItemId: string;
  leadId: string;
  name: string | null;
  state: string | null;
  attemptsMade: number;
  tier: number;
  tierName: string;
  tierReason: string;
  assignedToYou: boolean;
  /** "scored" or "control" while scoring is on; null when it is off (there is no experiment). */
  cohort: "scored" | "control" | null;
  /** score_lead's raw score, in weight units (0–100 at the default weights). */
  score: number | null;
  reasons: string[];
  /** LA-2.13-2 · each signal's share of the score (score_lead's own factors). Null when not read. */
  breakdown?: SignalBreakdown[] | null;
};

/** One signal's part of a lead's score: its 0–1 factor, its weight and the points they make. */
export type SignalBreakdown = { signal: string; label: string; factor: number; weight: number; points: number };

/**
 * score_lead's `signals` (factor per signal, plus the weights it used) as rows, in the order of
 * `labels`: points = weight × factor, and the points add up to the score (score_lead rounds the sum
 * to three places). Anything malformed is left out rather than guessed.
 */
export function signalBreakdown(signals: unknown, labels: ReadonlyArray<{ signal: string; label: string }>): SignalBreakdown[] {
  const raw = record(signals);
  const weights = record(raw.weights);
  const out: SignalBreakdown[] = [];
  for (const { signal, label } of labels) {
    const factor = numOrNull(raw[signal]);
    const weight = numOrNull(weights[signal]);
    if (factor === null || weight === null) continue;
    out.push({ signal, label, factor, weight, points: Math.round(weight * factor * 1000) / 1000 });
  }
  return out;
}

/** "8.0 of 20 pts" — how a signal filled its weight. */
export function breakdownLine(row: SignalBreakdown): string {
  return `${row.points.toFixed(1)} of ${row.weight.toFixed(row.weight % 1 === 0 ? 0 : 1)} pts`;
}

export type HeldBackRow = {
  workItemId: string;
  leadId: string;
  name: string | null;
  state: string | null;
  attemptsMade: number;
  tierName: string;
  /** tenant_dial_window's reason code: before_open, after_close, state_no_sunday, … */
  reason: string;
  zone: string | null;
  startMinute: number | null;
  localMinute: number | null;
  minutesUntilOpen: number | null;
};

export type QueuePreview = {
  generatedAt: string;
  enabled: boolean;
  /** True when the order within a tier is by score — scoring is on and the scored cohort has leads. */
  ranked: boolean;
  holdoutPct: number;
  totalWeight: number;
  capacityGate: boolean;
  poolOpen: boolean;
  servableCount: number;
  heldBackCount: number;
  rows: PreviewRow[];
  heldBack: HeldBackRow[];
};

const num = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};
const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The RPC's snake_case JSON, normalised. Anything malformed becomes an empty preview, not a throw. */
export function normalizePreview(value: unknown): QueuePreview {
  const raw = record(value);
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const held = Array.isArray(raw.held_back) ? raw.held_back : [];
  return {
    generatedAt: str(raw.generated_at),
    enabled: raw.enabled === true,
    ranked: raw.ranked === true,
    holdoutPct: num(raw.holdout_pct),
    totalWeight: num(raw.total_weight),
    capacityGate: raw.capacity_gate === true,
    poolOpen: raw.pool_open !== false,
    servableCount: num(raw.servable_count),
    heldBackCount: num(raw.held_back_count),
    rows: rows.map((entry) => {
      const row = record(entry);
      const cohort = row.cohort === "scored" || row.cohort === "control" ? row.cohort : null;
      return {
        position: num(row.position),
        workItemId: str(row.work_item_id),
        leadId: str(row.lead_id),
        name: strOrNull(row.name),
        state: strOrNull(row.state),
        attemptsMade: num(row.attempts_made),
        tier: num(row.tier),
        tierName: str(row.tier_name),
        tierReason: str(row.tier_reason),
        assignedToYou: row.assigned_to_you === true,
        cohort,
        score: numOrNull(row.score),
        reasons: Array.isArray(row.reasons) ? row.reasons.filter((reason): reason is string => typeof reason === "string") : [],
      };
    }),
    heldBack: held.map((entry) => {
      const row = record(entry);
      return {
        workItemId: str(row.work_item_id),
        leadId: str(row.lead_id),
        name: strOrNull(row.name),
        state: strOrNull(row.state),
        attemptsMade: num(row.attempts_made),
        tierName: str(row.tier_name),
        reason: str(row.reason) || "closed",
        zone: strOrNull(row.zone),
        startMinute: numOrNull(row.start_minute),
        localMinute: numOrNull(row.local_minute),
        minutesUntilOpen: numOrNull(row.minutes_until_open),
      };
    }),
  };
}

/**
 * The score as the board prints it, 0–1: the raw score over the total of the effective weights.
 * At the default weights (which sum to 100) that is score ÷ 100. Null when there is no score or
 * every weight is zero.
 */
export function scoreShare(score: number | null, totalWeight: number): number | null {
  if (score === null || !Number.isFinite(score) || !(totalWeight > 0)) return null;
  return Math.max(0, Math.min(1, score / totalWeight));
}

/** "0.86". */
export function shareLabel(share: number | null): string {
  return share === null ? "—" : share.toFixed(2);
}

/** Minute of the day as a clock: 480 → "8:00 AM". */
export function minuteClock(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m % 60).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "PT", "CT", "ET" from an IANA zone, or its abbreviation where Intl knows one. */
export function zoneAbbrev(zone: string | null, at = new Date()): string {
  if (!zone) return "";
  const common: Record<string, string> = {
    "America/New_York": "ET", "America/Detroit": "ET", "America/Indiana/Indianapolis": "ET", "America/Kentucky/Louisville": "ET",
    "America/Chicago": "CT", "America/Denver": "MT", "America/Phoenix": "MT", "America/Boise": "MT",
    "America/Los_Angeles": "PT", "America/Anchorage": "AKT", "Pacific/Honolulu": "HT",
  };
  if (common[zone]) return common[zone];
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** "48 minutes", "1 hour 5 minutes", "under a minute". */
export function minutesPhrase(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 1) return "under a minute";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const h = hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "";
  const m = rest ? `${rest} minute${rest === 1 ? "" : "s"}` : "";
  return [h, m].filter(Boolean).join(" ");
}

/**
 * Why a due lead is not being served, in the board's sentence shape:
 * "Not served — 7:12 AM their time, the window opens at 8:00 AM MT. Enters the queue in 48 minutes."
 */
export function heldBackSentence(row: Pick<HeldBackRow, "reason" | "zone" | "startMinute" | "localMinute" | "minutesUntilOpen">): string {
  const tz = zoneAbbrev(row.zone);
  const local = row.localMinute === null ? null : `${minuteClock(row.localMinute)} their time`;
  switch (row.reason) {
    case "before_open": {
      const opens = row.startMinute === null ? "the calling window has not opened yet" : `the window opens at ${minuteClock(row.startMinute)}${tz ? ` ${tz}` : ""}`;
      const enters = row.minutesUntilOpen === null ? "" : ` Enters the queue in ${minutesPhrase(row.minutesUntilOpen)}.`;
      return `Not served — ${[local, opens].filter(Boolean).join(", ")}.${enters}`;
    }
    case "after_close":
      return `Not served — ${local ? `${local}, ` : ""}the calling window has closed for today.`;
    case "state_no_sunday":
      return "Not served — the state bars Sunday calls.";
    case "agency_no_sunday":
      return "Not served — your agency does not call on Sundays.";
    case "state_holiday":
      return "Not served — a state holiday.";
    case "federal_holiday":
      return "Not served — a federal holiday, and your agency does not call on them.";
    case "no_window":
      return "Not served — the calling rules leave no window today.";
    case "rules_stale":
      return "Not served — the calling rules are out of date, so no one is dialled until they are refreshed.";
    case "no_state":
      return "Not served — the lead has no state, so its calling window is unknown.";
    case "no_zone":
      return "Not served — no timezone is known for this state.";
    default:
      return "Not served — outside the calling window.";
  }
}

/** "Dolores Ruiz · AZ · att 3" — the attempt this dial would be, as the board counts it. */
export function leadLine(row: { name: string | null; state: string | null; attemptsMade: number }): string {
  return [row.name ?? "Unnamed lead", row.state, `att ${row.attemptsMade + 1}`].filter(Boolean).join(" · ");
}

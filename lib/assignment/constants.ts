/**
 * Lead assignment — the shapes and labels both sides of the page share.
 *
 * No `server-only` here on purpose: the workspace is a client component, and a value imported from
 * service.ts would compile under tsc and fail at build (see the repo's note on the RSC boundary).
 */

export type MatchType = "realtime" | "language" | "campaign" | "product" | "state" | "fallback";

export const MATCH_TYPES: readonly MatchType[] = ["realtime", "language", "campaign", "product", "state", "fallback"];

export const MATCH_LABEL: Record<MatchType, string> = {
  realtime: "Real-time lead",
  language: "Language",
  campaign: "Campaign",
  product: "Product",
  state: "State",
  fallback: "Fallback",
};

export const MATCH_OPERATOR: Record<MatchType, string> = {
  realtime: "arrived within",
  language: "matches pairing",
  campaign: "is one of",
  product: "is one of",
  state: "is one of",
  fallback: "round-robin across",
};

/** The match_values key each type stores its list under (fallback stores none, realtime a number). */
export const VALUE_KEY: Record<Exclude<MatchType, "fallback" | "realtime">, string> = {
  language: "languages",
  campaign: "campaign_ids",
  product: "products",
  state: "states",
};

/** How a rule picks among the people it may give the lead to (20260925702100). */
export type RuleStrategy = "round_robin" | "least_loaded";
export const RULE_STRATEGIES: readonly RuleStrategy[] = ["round_robin", "least_loaded"];
export const STRATEGY_LABEL: Record<RuleStrategy, string> = {
  round_robin: "Round robin",
  least_loaded: "Fewest open first",
};

/** The match types an extra AND-condition may use. */
export type ConditionType = "campaign" | "state" | "language" | "product";
export const CONDITION_TYPES: readonly ConditionType[] = ["state", "product", "language", "campaign"];
/** A rule matches on its own condition plus at most this many more (3 in all). */
export const MAX_EXTRA_CONDITIONS = 2;
export type RuleCondition = { match_type: ConditionType; match_values: Record<string, unknown> };

export type AssignmentRule = {
  id: string;
  priority: number;
  match_type: MatchType;
  match_values: Record<string, unknown>;
  assignee_ids: string[];
  is_active: boolean;
  last_assignee_id: string | null;
  created_at: string;
  updated_at: string;
  /** Absent before 20260925702100: every rule is round robin with no extra conditions. */
  strategy?: RuleStrategy;
  conditions?: RuleCondition[];
};

export type AssignmentMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  capacity: number;
  currentOpen: number;
  languages: string[];
  weekdayOff: number | null;
  /** States this agent may be handed a lead in. Null for setters (no licence is asked of them) and when it could not be worked out. */
  eligibleStates: string[] | null;
  /** Personal licences lapsing within LICENCE_WARNING_DAYS, or lapsed and still holding open leads there. */
  licenceExpiring: LicenceExpiry[];
};

/** A personal licence (Team & access) that lapses soon, or has lapsed with open leads still in its state. */
export type LicenceExpiry = { state: string; expiresOn: string; openLeads: number };

/** How far ahead a personal licence lapse is warned about. */
export const LICENCE_WARNING_DAYS = 30;

export type AssignmentInsights = {
  since: string;
  routed: Record<string, number>;
  /** user_id is null only for a 'licence' skip: the whole rule was refused by the licence gate. */
  skips: { rule_id: string | null; user_id: string | null; reason: SkipReason; count: number }[];
  skippedLeads: { user_id: string; reason: SkipReason; leads: number }[];
  unlicensedLeads: number | null;
  /** Where the leads a rule skipped someone on were finally routed; landed_rule_id null = whole roster. */
  landed: { rule_id: string; landed_rule_id: string | null; leads: number }[];
  /** Leads routed on arrival (auto-route) since `since`. */
  autoRouted: number;
};

export type SkipReason = "capacity" | "rest" | "household" | "day_off" | "licence";

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  capacity: "full",
  rest: "resting",
  household: "household held",
  day_off: "day off",
  licence: "licence",
};

export type AssignmentWorkspace = {
  rules: AssignmentRule[];
  members: AssignmentMember[];
  settings: { rest_days: number; attempts_before_rotate: number | null; auto_route_posted: boolean; updated_at: string | null };
  campaigns: { id: string; name: string }[];
  insights: AssignmentInsights | null;
  /** False until 20260924300000 is applied: the new rule type, languages, day off, rotation and the stats are unavailable. */
  boardSchema: boolean;
  /** False until 20260925702100 is applied: strategies, AND-conditions and routing on arrival are unavailable. */
  routerSchema: boolean;
  /** Start of the stats window (Monday 00:00 UTC of this week). */
  since: string;
};

export type PreviewRow = {
  work_item_id: string;
  lead_id: string;
  name: string;
  state: string | null;
  outcome: "routed" | "nobody" | "taken" | "error";
  owner_user_id: string | null;
  owner_role: string | null;
  rule_id: string | null;
  full_user_ids: string[];
  setter_without_licensed_agent: boolean | null;
  detail: NoEligibleDetail | null;
  licence_reason: string | null;
  error: string | null;
};

export type NoEligibleDetail = {
  leads_tried?: number;
  state?: string;
  product?: string;
  requires_licensed?: boolean;
  candidates?: number;
  licence?: number;
  language?: number;
  day_off?: number;
  rest?: number;
  household?: number;
  capacity?: number;
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "the District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

/** "OR" → "Oregon"; anything unknown comes back as given. */
export function stateName(code: string) {
  return STATE_NAMES[code.toUpperCase()] ?? code;
}

export const SCHEMA_PENDING_MESSAGE = "This setting needs a database update that has not been applied yet.";

/* ── bulk list assignment (20260924342000) ─────────────────────────────── */

/** "Assign by": the published chain, one named owner, or the named members in turn. */
export type LeadListAssignMode = "chain" | "owner" | "round_robin";
export const LEAD_LIST_ASSIGN_MODES: readonly LeadListAssignMode[] = ["chain", "owner", "round_robin"];

/** The most unowned leads one bulk assignment moves (assign_lead_list refuses above it). */
export const LEAD_LIST_ASSIGN_LIMIT = 5000;

export const LIST_CHANGED_MESSAGE = "The list changed since the preview — review the new numbers";

/** rule_types: a rule's match_type, "roster" for the implicit whole-roster fallback, "manual" for a named owner. */
export type LeadListOwnerRow = { user_id: string; name: string; gets: number; states: string[]; rule_types: string[]; capacity_skips: number };
export type LeadListNobodyRow = { state: string | null; count: number; reason: string; detail: string | null };
export type LeadListAssignmentPreview = {
  total: number;
  routable: number;
  nobody_count: number;
  per_owner: LeadListOwnerRow[];
  nobody: LeadListNobodyRow[];
};

/** The "Why" cell for one owner, from what the dry run actually did for them. */
export function ownerWhy(row: LeadListOwnerRow): string {
  if (row.gets === 0) return row.capacity_skips > 0 ? `At capacity — ${row.capacity_skips.toLocaleString("en-US")} skipped` : "None they can take";
  if (row.capacity_skips > 0) return `Full after ${row.gets.toLocaleString("en-US")} — ${row.capacity_skips.toLocaleString("en-US")} skipped`;
  const types = row.rule_types ?? [];
  if (types.length > 0 && types.every((type) => type === "fallback" || type === "roster")) {
    return types.includes("fallback") ? "Fallback rule" : "No rule matched — whole roster";
  }
  const states = [...(row.states ?? [])].sort();
  if (!states.length) return types.includes("manual") ? "Chosen owner" : "Routed by the rules";
  const shown = states.length > 3 ? `${states.slice(0, 3).join(" + ")} + ${states.length - 3} more` : states.join(" + ");
  return `${shown} licensed`;
}

/**
 * Below half the agency's workable states an agent's chip turns amber. The agency figure is the
 * union of every licensed agent's states, so an agent at the agency's full reach reads green and
 * one who can take a small slice of the book reads as a constraint worth seeing.
 */
export const LICENCE_REACH_WARNING_SHARE = 0.5;

/** "Ray Delgado" → "R. Delgado", as the board prints people. One word stays whole. */
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim() || "Unknown";
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/** Monday 00:00 UTC of the week containing `now` — the window "this week" means on this page. */
export function weekStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d;
}

/** Why nobody could take a lead, in one sentence, from NO_ELIGIBLE_ASSIGNEE's counts. */
export function nobodySentence(detail: NoEligibleDetail | null | undefined): string {
  if (!detail) return "Nobody on the roster may take this lead right now.";
  if ((detail.leads_tried ?? 1) > 1) {
    return `None of the next ${detail.leads_tried} leads in the queue has anyone who may take it right now.`;
  }
  if (!detail.candidates) return "Nobody active is on the rules this lead matches.";
  const parts: string[] = [];
  const add = (n: number | undefined, text: string) => { if (n) parts.push(`${n} ${text}`); };
  add(detail.capacity, "at their capacity ceiling");
  add(detail.day_off, "on their day off");
  add(detail.rest, "resting from this household");
  add(detail.household, "kept off because another agent holds this household");
  add(detail.language, "without the lead's language");
  add(detail.licence, detail.state ? `not licensed or not allowed for a ${detail.state} lead` : "not allowed for a lead with no state");
  return parts.length ? `Nobody could take this lead: ${parts.join(", ")}.` : "Nobody on the roster may take this lead right now.";
}

/* ── personal licence expiry (20260925702000) ─────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Whole days from today (UTC) to a YYYY-MM-DD date; negative once it has passed. */
export function daysUntil(date: string, now = new Date()) {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.UTC(y, (m ?? 1) - 1, d ?? 1) - today) / 86_400_000);
}

/** "2026-10-04" → "4 Oct". */
export function shortDate(date: string) {
  const [, m, d] = date.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1] ?? ""}`.trim();
}

/** "OH lapses in 12 days", "OH lapses today", "OH lapsed 2 Oct". The licence still counts on its expiry date and stops the day after. */
export function lapseLabel(entry: LicenceExpiry, now = new Date()) {
  const days = daysUntil(entry.expiresOn, now);
  if (days < 0) return `${entry.state} lapsed ${shortDate(entry.expiresOn)}`;
  if (days === 0) return `${entry.state} lapses today`;
  if (days === 1) return `${entry.state} lapses tomorrow`;
  return `${entry.state} lapses in ${days} days`;
}

/** The day the licence stops counting: the day after its expiry date. */
export function lapseDay(entry: LicenceExpiry) {
  const [y, m, d] = entry.expiresOn.slice(0, 10).split("-").map(Number);
  const next = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + 1));
  return shortDate(next.toISOString());
}

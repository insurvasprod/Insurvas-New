// The audit-log screen's pure pieces: filter parsing, UTC day bounds, time formatting, search and
// the actor dropdown's value encoding. Client-safe and import-free, so the table component, the API
// route and node:test (logView.test.mjs) all use the same code.

export type AuditActorType = "admin" | "tenant" | "system";

/** One row as the table receives it. Labels are resolved on the server. */
export type AuditLogEntry = {
  id: string;
  ts: string;
  /** "22 Sep 2026 08:40:55 UTC" — formatted on the server so hydration cannot differ. */
  whenUtc: string;
  actor_type: AuditActorType;
  actor_id: string | null;
  /** What the Actor cell shows: an email, "System", or a fallback that says why there is none. */
  actorLabel: string;
  /** Name and email for the detail dialog and the hover text. */
  actorDetail: string | null;
  action: string;
  actionLabel: string | null;
  target_type: string | null;
  target_id: string | null;
  /** A readable name for the target (an agency name, an invoice number), when one could be found. */
  targetLabel: string | null;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: unknown;
};

export type AuditLogFilters = {
  action: string | null;
  actorType: AuditActorType | null;
  actorId: string | null;
  /** YYYY-MM-DD, a UTC day, inclusive. */
  from: string | null;
  /** YYYY-MM-DD, a UTC day, inclusive: the whole of that day is included. */
  to: string | null;
  target: string | null;
  q: string | null;
  page: number;
};

const ACTOR_TYPES: readonly AuditActorType[] = ["admin", "tenant", "system"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 200;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function isRealDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null;
}

/**
 * Reads the list filters from a query string. Anything malformed is dropped rather than passed to
 * the database: an unknown action, a non-uuid actor, a date that is not a real calendar day.
 */
export function parseAuditLogFilters(
  params: { get(name: string): string | null },
  knownActions: readonly string[],
): AuditLogFilters {
  const action = params.get("action");
  const actorType = params.get("actorType");
  const actorId = params.get("actorId");
  const from = params.get("from");
  const to = params.get("to");
  const page = Math.floor(Number(params.get("page")));
  return {
    action: action && knownActions.includes(action) ? action : null,
    actorType: actorType && (ACTOR_TYPES as readonly string[]).includes(actorType) ? (actorType as AuditActorType) : null,
    actorId: actorId && isUuid(actorId) ? actorId : null,
    from: from && isRealDay(from) ? from : null,
    to: to && isRealDay(to) ? to : null,
    target: text(params.get("target")),
    q: text(params.get("q")),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/**
 * The timestamps a from/to day pair means. `to` is inclusive of its whole day, so the upper bound is
 * the START of the next day, compared with `<`. (Comparing `ts <= "2026-09-22"` meant midnight at the
 * start of the 22nd, which left out everything that happened on the day the filter named.)
 */
export function utcDayBounds(from: string | null, to: string | null): { gte: string | null; lt: string | null } {
  let lt: string | null = null;
  if (to) {
    const next = new Date(`${to}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    lt = next.toISOString();
  }
  return { gte: from ? `${from}T00:00:00.000Z` : null, lt };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** "22 Sep 2026 08:40:55 UTC". Built from the UTC fields, so no locale or zone can change it. */
export function formatUtc(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function ago(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

/** The hint under the absolute time: "4 minutes ago". Never the only time shown. */
export function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return ago(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ago(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return ago(days, "day");
  const months = Math.floor(days / 30.44);
  if (months < 12) return ago(Math.max(1, months), "month");
  return ago(Math.floor(days / 365.25), "year");
}

/**
 * The search box's action half: every known action whose code or label contains the text. The
 * other half is an exact target id, so the query stays on indexed columns (action, target_id).
 */
export function searchMatchingActions(
  q: string,
  knownActions: readonly string[],
  labels: Readonly<Record<string, string>>,
): string[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return knownActions.filter(
    (action) => action.toLowerCase().includes(needle) || (labels[action] ?? "").toLowerCase().includes(needle),
  );
}

/** A value for a PostgREST `or=(...)` filter: double-quoted, with `\` and `"` escaped. */
export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * PostgREST's `count=estimated` is exact up to the API's max-rows setting (Supabase's default is
 * 1,000) and the planner's estimate beyond it, so a larger total is said as "about".
 */
export const AUDIT_LOG_EXACT_COUNT_CEILING = 1000;

export function isApproximateCount(total: number): boolean {
  return total > AUDIT_LOG_EXACT_COUNT_CEILING;
}

// The actor dropdown's values: "all", a kind of actor, or one staff member.
export type ActorChoice = { actorType: AuditActorType | null; actorId: string | null };

export function encodeActorChoice(choice: ActorChoice): string {
  if (choice.actorId) return `id:${choice.actorId}`;
  if (choice.actorType) return `type:${choice.actorType}`;
  return "all";
}

export function decodeActorChoice(value: string): ActorChoice {
  if (value.startsWith("id:") && isUuid(value.slice(3))) return { actorType: null, actorId: value.slice(3) };
  if (value.startsWith("type:")) {
    const type = value.slice(5);
    if ((ACTOR_TYPES as readonly string[]).includes(type)) return { actorType: type as AuditActorType, actorId: null };
  }
  return { actorType: null, actorId: null };
}

/** The number on the Filters button: action, date range and target each count once. */
export function activeFilterCount(filters: { action: string | null; from: string | null; to: string | null; target: string | null }): number {
  return (filters.action ? 1 : 0) + (filters.from || filters.to ? 1 : 0) + (filters.target ? 1 : 0);
}

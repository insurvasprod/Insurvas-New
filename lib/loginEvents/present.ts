// Wording and filters for the staff Login activity page (p-adm-activity). Plain module — only plain imports,
// no `server-only` — so the client feed, the API route and the tests all read the same rules.

import { csvCellMinimal } from "../csv/cell.ts";

/* ── filters ─────────────────────────────────────────────────────────────── */

export type ActivityOutcome = "all" | "success" | "failure";
export type ActivityActor = "all" | "user" | "admin";
export type ActivityRange = "today" | "7d" | "30d" | "all";

export type ActivityFilters = {
  outcome: ActivityOutcome;
  actor: ActivityActor;
  range: ActivityRange;
  q: string;
};

/** The board's count line reads "… attempts today", so the page opens on today. */
export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = { outcome: "all", actor: "all", range: "today", q: "" };

export const OUTCOME_OPTIONS: { value: ActivityOutcome; label: string; chip: string }[] = [
  { value: "all", label: "All outcomes", chip: "any" },
  { value: "success", label: "Successful only", chip: "success" },
  { value: "failure", label: "Failed only", chip: "failed" },
];

export const ACTOR_OPTIONS: { value: ActivityActor; label: string; chip: string }[] = [
  { value: "all", label: "Anyone", chip: "any" },
  { value: "user", label: "Tenant users", chip: "tenant users" },
  { value: "admin", label: "Staff (admins)", chip: "staff" },
];

export const RANGE_OPTIONS: { value: ActivityRange; label: string; phrase: string }[] = [
  { value: "today", label: "Today (UTC)", phrase: "today" },
  { value: "7d", label: "Last 7 days", phrase: "in the last 7 days" },
  { value: "30d", label: "Last 30 days", phrase: "in the last 30 days" },
  { value: "all", label: "All time", phrase: "recorded" },
];

/**
 * The lenses on Login activity's title line (admin round 1, monitoring.html screen 2): every attempt, the failed
 * ones (the Outcome filter set to failed), and "Repeated failures" — failed attempts from an address that failed
 * at least REPEATED_FAILURE_MIN times in the range. The lens lives in the address (`?lens=repeated`); "Failed" is
 * `?outcome=failure`, so the Outcome filter and the tab can never disagree.
 */
export type ActivityLens = "all" | "failed" | "repeated";

export const REPEATED_FAILURE_MIN = 3;

export function parseActivityLens(params: { get(name: string): string | null }): ActivityLens {
  if (params.get("lens") === "repeated") return "repeated";
  return params.get("outcome") === "failure" ? "failed" : "all";
}

/** The query string for a view of the feed: only what differs from the defaults, so a shared link stays short. */
export function activityQuery(filters: ActivityFilters, extra: { lens?: ActivityLens; page?: number } = {}): string {
  const params = new URLSearchParams();
  if (extra.lens === "repeated") params.set("lens", "repeated");
  if (filters.outcome !== "all") params.set("outcome", filters.outcome);
  if (filters.actor !== "all") params.set("actor", filters.actor);
  if (filters.range !== DEFAULT_ACTIVITY_FILTERS.range) params.set("range", filters.range);
  if (filters.q) params.set("q", filters.q);
  if (extra.page && extra.page > 1) params.set("page", String(extra.page));
  return params.toString();
}

export type RepeatedFailure = { ip: string; attempts: number; accounts: number; lastAt: string };

/**
 * Addresses with at least `min` failed attempts among `events`, worst first: how many attempts and on how many
 * accounts. Attempts with no recorded IP are left out — "no address" is not one address.
 */
export function repeatedFailures(
  events: ReadonlyArray<{ ip: string | null; email: string; success: boolean; ts: string }>,
  min = REPEATED_FAILURE_MIN,
): RepeatedFailure[] {
  const byIp = new Map<string, { attempts: number; accounts: Set<string>; lastAt: string }>();
  for (const event of events) {
    if (event.success || !event.ip) continue;
    const entry = byIp.get(event.ip) ?? { attempts: 0, accounts: new Set<string>(), lastAt: event.ts };
    entry.attempts += 1;
    entry.accounts.add(event.email.toLowerCase());
    if (event.ts > entry.lastAt) entry.lastAt = event.ts;
    byIp.set(event.ip, entry);
  }
  return [...byIp.entries()]
    .filter(([, entry]) => entry.attempts >= min)
    .map(([ip, entry]) => ({ ip, attempts: entry.attempts, accounts: entry.accounts.size, lastAt: entry.lastAt }))
    .sort((a, b) => b.attempts - a.attempts || b.lastAt.localeCompare(a.lastAt));
}

export const ACTIVITY_SEARCH_MAX = 100;

function oneOf<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Query-string input to filters. Anything unrecognised falls back to the default, never errors. */
export function parseActivityFilters(params: { get(name: string): string | null }): ActivityFilters {
  return {
    outcome: oneOf(params.get("outcome"), ["all", "success", "failure"] as const, "all"),
    actor: oneOf(params.get("actor"), ["all", "user", "admin"] as const, "all"),
    range: oneOf(params.get("range"), ["today", "7d", "30d", "all"] as const, DEFAULT_ACTIVITY_FILTERS.range),
    q: (params.get("q") ?? "").trim().slice(0, ACTIVITY_SEARCH_MAX),
  };
}

/** How many of the Filters popover's settings (actor, range) differ from the page's default. */
export function popoverFilterCount(filters: ActivityFilters): number {
  return (filters.actor !== DEFAULT_ACTIVITY_FILTERS.actor ? 1 : 0) + (filters.range !== DEFAULT_ACTIVITY_FILTERS.range ? 1 : 0);
}

/** Start of the range, or null for all time. "Today" is the UTC day, like the tiles. */
export function rangeStart(range: ActivityRange, now: number): Date | null {
  if (range === "all") return null;
  if (range === "7d") return new Date(now - 7 * 24 * 60 * 60 * 1000);
  if (range === "30d") return new Date(now - 30 * 24 * 60 * 60 * 1000);
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/**
 * The count line under the toolbar: "412 of 412 attempts today". The second figure is every attempt
 * in the range, so the line follows the range and says what the other filters removed.
 */
export function countLine(matching: number, inRange: number, range: ActivityRange): string {
  const phrase = RANGE_OPTIONS.find((option) => option.value === range)?.phrase ?? "";
  const noun = inRange === 1 ? "attempt" : "attempts";
  return `${matching.toLocaleString("en-US")} of ${inRange.toLocaleString("en-US")} ${noun} ${phrase}`.trim();
}

/**
 * PostgREST `or=` values are quoted, so `"` and `\` need escaping there; inside the ilike pattern
 * `%`, `_` and `\` are wildcards/escapes and are made literal first, so a search for "a_b" does not
 * match "axb".
 */
export function ilikeContains(term: string): string {
  const literal = term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `%${literal}%`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/* ── row wording ─────────────────────────────────────────────────────────── */

/** The short reason after "Failed — " in the Outcome pill. */
const FAILURE_SHORT: Record<string, string> = {
  // Supabase Auth rejects an unknown email and a wrong password the same way, so "bad password"
  // would claim something we do not know. "Credentials" covers both; the full reason is on hover.
  invalid_credentials: "bad credentials",
  no_password_set: "invite pending",
  suspended: "suspended",
  inactive: "inactive",
  no_membership: "no workspace",
  invalid_2fa: "wrong 2FA code",
  expired_2fa: "2FA expired",
  locked_out: "locked",
  rate_limited: "rate limited",
};

export function loginOutcomeLabel(event: { success: boolean; failure_reason: string | null; actor_type: "user" | "admin" }): string {
  if (event.success) return event.actor_type === "admin" ? "Success · admin" : "Success";
  if (!event.failure_reason) return "Failed";
  return `Failed — ${FAILURE_SHORT[event.failure_reason] ?? event.failure_reason.replace(/_/g, " ")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * "22 Sep 2026 08:44:12 UTC". Spelled out and pinned to UTC so the server render and the browser
 * print the same text (Intl's en-GB September is "Sept" in newer ICU).
 */
export function loginEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

/**
 * "Chrome 140 · Windows" from a raw user-agent string. A best-effort summary for scanning the table;
 * the raw string stays on hover. Order matters: Edge and Opera also say "Chrome", Chrome also says
 * "Safari", and every iPhone browser is WebKit underneath.
 */
export function summariseUserAgent(ua: string | null | undefined): string | null {
  if (!ua || !ua.trim()) return null;

  const browsers: [RegExp, string][] = [
    [/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"],
    [/(?:OPR|Opera)\/(\d+)/, "Opera"],
    [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
    [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
    [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
    [/Version\/(\d+)(?:\.\d+)*.*Safari\//, "Safari"],
  ];
  let browser: string | null = null;
  for (const [pattern, name] of browsers) {
    const match = ua.match(pattern);
    if (match) {
      browser = `${name} ${match[1]}`;
      break;
    }
  }

  const systems: [RegExp, string][] = [
    [/iPhone|iPad|iPod/, "iOS"],
    [/Android/, "Android"],
    [/CrOS/, "ChromeOS"],
    [/Windows/, "Windows"],
    [/Mac OS X|Macintosh/, "macOS"],
    [/Linux/, "Linux"],
  ];
  const system = systems.find(([pattern]) => pattern.test(ua))?.[1] ?? null;

  if (!browser && !system) {
    // Not a browser we recognise (curl, a script, a bot): show what it calls itself.
    const token = ua.trim().split(/\s+/)[0] ?? "";
    return token.length > 40 ? `${token.slice(0, 40)}…` : token;
  }
  return [browser, system].filter(Boolean).join(" · ");
}

/**
 * "Chrome on Windows", the Device column (monitoring.html screen 2): the browser and system without version
 * numbers, for scanning. summariseUserAgent keeps the versions for the hover and the sheet; null when unknown.
 */
export function deviceLabel(ua: string | null | undefined): string | null {
  const summary = summariseUserAgent(ua);
  if (!summary) return null;
  const [browser, system] = summary.split(" · ");
  if (!system) return browser.replace(/ \d+$/, "");
  return `${browser.replace(/ \d+$/, "")} on ${system}`;
}

/** One CSV cell: the product's one escaper (lib/csv/cell.ts, itself a plain module), quoting only when needed. */
export const csvCell: (value: string | number | boolean | null | undefined) => string = csvCellMinimal;

/** Login attempts as CSV, the columns the table shows plus the raw user agent. */
export function loginEventsCsv(events: ReadonlyArray<{ ts: string; email: string; actor_type: "user" | "admin"; success: boolean; failure_reason: string | null; ip: string | null; user_agent: string | null }>): string {
  const head = ["When (UTC)", "Actor", "Actor type", "Outcome", "IP", "Device", "User agent"];
  const lines = events.map((event) => [
    event.ts,
    event.email,
    event.actor_type === "admin" ? "staff" : "customer",
    loginOutcomeLabel(event),
    event.ip,
    deviceLabel(event.user_agent),
    event.user_agent,
  ].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\r\n");
}

/* ── tiles ───────────────────────────────────────────────────────────────── */

/**
 * "+6% vs same time last week". Null when last week has nothing to compare with — a percentage of
 * zero is not a number, and "+∞%" is not a sentence.
 */
export function weekOverWeek(thisWeek: number, lastWeekToDate: number | null): string | null {
  if (lastWeekToDate === null || lastWeekToDate <= 0) return null;
  const change = Math.round(((thisWeek - lastWeekToDate) / lastWeekToDate) * 100);
  const sign = change > 0 ? "+" : change < 0 ? "−" : "±";
  return `${sign}${Math.abs(change)}% vs same time last week`;
}

/* ── who sees staff sign-ins ─────────────────────────────────────────────── */

/**
 * Staff (actor_type 'admin') sign-ins carry staff email addresses and IPs. Only super_admin sees
 * them; support_agent and billing_admin read tenant-user sign-ins only. The API route, the server
 * page and the feed's actor filter all ask this one function.
 */
export function staffLoginsVisibleTo(role: string): boolean {
  return role === "super_admin";
}

/** The actor filter's choices for this viewer: no "Staff" choice for a role that cannot see staff. */
export function actorOptionsFor(role: string): typeof ACTOR_OPTIONS {
  return staffLoginsVisibleTo(role) ? ACTOR_OPTIONS : ACTOR_OPTIONS.filter((option) => option.value !== "admin");
}

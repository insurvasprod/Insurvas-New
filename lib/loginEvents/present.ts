// Wording and filters for the staff Login activity page (p-adm-activity). Plain module — no imports,
// no `server-only` — so the client feed, the API route and the tests all read the same rules.

/* ── filters ─────────────────────────────────────────────────────────────── */

export type ActivityOutcome = "all" | "success" | "failure";
export type ActivityActor = "all" | "user" | "admin";
export type ActivityRange = "today" | "7d" | "all";

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
  { value: "all", label: "All time", phrase: "recorded" },
];

export const ACTIVITY_SEARCH_MAX = 100;

function oneOf<T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Query-string input to filters. Anything unrecognised falls back to the default, never errors. */
export function parseActivityFilters(params: { get(name: string): string | null }): ActivityFilters {
  return {
    outcome: oneOf(params.get("outcome"), ["all", "success", "failure"] as const, "all"),
    actor: oneOf(params.get("actor"), ["all", "user", "admin"] as const, "all"),
    range: oneOf(params.get("range"), ["today", "7d", "all"] as const, DEFAULT_ACTIVITY_FILTERS.range),
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

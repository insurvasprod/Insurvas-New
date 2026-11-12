/**
 * Settings › Lead posting, round 8 option A ("Vendor list + vendor sheet", owner pick 2026-11-12):
 * the shapes the vendor table, the vendor sheet and the wizard share with the server, and the rules
 * that decide a vendor's status, a refusal's fix and whether a post is inside its hours.
 *
 * Plain module — no `server-only`, no path aliases — so the screen, the post path and `node --test`
 * all read the same rules.
 */
import type { PostCampaign, PostKey } from "./types.ts";

/** When a vendor's posts are taken, in the agency's words: days 0 (Sunday) – 6, "HH:MM" 24-hour. */
export type PostingHours = { days: number[]; start: string; end: string; timeZone: string };

/** The settings round 8 adds to a key (migration 20261112100100). Null on the board until it is applied. */
export type VendorSettings = {
  testMode: boolean;
  priceCents: number | null;
  dailyCap: number | null;
  postingHours: PostingHours | null;
  callbackUrl: string | null;
  callbackEvents: string[];
  callbackLastAt: string | null;
  callbackLastStatus: number | null;
  graceUntil: string | null;
  notes: string;
  instructionsEmail: string | null;
  instructionsSentAt: string | null;
  instructionsOpened: number;
  instructionsLastOpenedAt: string | null;
  /** True once a public instructions link has been made (the token itself is never returned). */
  instructionsLink: boolean;
};

export type BoardCampaign = PostCampaign & {
  productCode: string | null;
  productLabel: string;
  /** An active intake form exists for the campaign's product, so an accepted post can become a lead. */
  intakeForm: boolean;
  /** Active and scrubbed (campaigns_servable): posts can land here right now. */
  servable: boolean;
};

export type VendorStatus = "live" | "needs_you" | "testing" | "waiting" | "paused" | "revoked";

export type VendorCounts = { posts: number; accepted: number; refused: number; tests: number };

export type VendorRow = {
  vendorId: string;
  vendorName: string;
  /** The active key, or the newest one when none is active. */
  key: PostKey;
  /** Every key the vendor has held, newest first. */
  keys: PostKey[];
  settings: VendorSettings | null;
  today: VendorCounts;
  week: VendorCounts;
  /** Refused posts over 7 days by reason, most first. */
  weekReasons: { reasonCode: string; count: number }[];
  lastPostAt: string | null;
  lastPostWasTest: boolean;
  status: VendorStatus;
  /** "2 fields", "phone": what "Needs you" is about. */
  needsYou: string | null;
  /** Their payload fields that look like one of ours but are not read (from their last post). */
  unreadGuesses: { theirs: string; ours: string }[];
};

export type LeadPostBoard = {
  vendors: VendorRow[];
  /** Every vendor on the agency's list, for the wizard; `connected` when it holds an active key. */
  allVendors: { id: string; name: string; leadType: string; connected: boolean }[];
  campaigns: BoardCampaign[];
  figures: { postsToday: number; acceptedToday: number; refusedToday: number; spendTodayCents: number | null };
  /** Migration 20260924130000 (campaign binding, field notes). */
  schemaReady: boolean;
  /** Migration 20261112100100 (test mode, price, cap, hours, callbacks, grace, notes, instructions). */
  r8Ready: boolean;
  agencyName: string;
  /** The per-workspace posting path. Copied, never drawn: it carries the workspace id. */
  postingPath: string;
  /** When the counts were read; "today" is the viewer's day. */
  readAt: string;
};

export const STATUS_LABEL: Record<VendorStatus, string> = {
  live: "Live",
  needs_you: "Needs you",
  testing: "Testing",
  waiting: "Waiting for first post",
  paused: "Paused",
  revoked: "Key revoked",
};

export const STATUS_TONE: Record<VendorStatus, "good" | "warning" | "info" | "neutral" | "danger"> = {
  live: "good",
  needs_you: "warning",
  testing: "info",
  waiting: "info",
  paused: "neutral",
  revoked: "danger",
};

/** The table's filter: All · Live · Needs you · Testing · Off. */
export type StatusFilter = "all" | "live" | "needs_you" | "testing" | "off";
export function statusInFilter(status: VendorStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "off") return status === "paused" || status === "revoked";
  if (filter === "testing") return status === "testing" || status === "waiting";
  return status === filter;
}

/** Refusals the agency or the vendor can fix (a bad map, a missing licence…), as opposed to the scrub working. */
export const FIXABLE_REASONS = new Set([
  "invalid_phone",
  "unknown_state",
  "missing_required_field",
  "missing_consent_text",
  "missing_consent_ip",
  "invalid_date_of_birth",
  "state_not_licensed",
  "campaign_not_accepting",
  "unauthorised",
]);

/** Short words for a "Needs you" chip. */
const NEEDS_WORD: Record<string, string> = {
  invalid_phone: "phone",
  unknown_state: "state",
  missing_required_field: "name",
  missing_consent_text: "consent",
  missing_consent_ip: "consent IP",
  invalid_date_of_birth: "birth date",
  state_not_licensed: "licence",
  campaign_not_accepting: "campaign",
  unauthorised: "key",
};

/**
 * A vendor's state, in one word. In order: no working key → revoked; test mode → testing; its campaign
 * cannot take posts → paused; fields that look like ours but are not read, or a fifth or more of a
 * week's posts refused for a fixable reason → needs you; never posted → waiting; else live.
 */
export function vendorStatus(input: {
  hasActiveKey: boolean;
  testMode: boolean;
  campaignServable: boolean | null;
  everPosted: boolean;
  week: VendorCounts;
  weekReasons: { reasonCode: string; count: number }[];
  unreadGuesses: number;
}): { status: VendorStatus; needsYou: string | null } {
  if (!input.hasActiveKey) return { status: "revoked", needsYou: null };
  if (input.testMode) return { status: "testing", needsYou: null };
  if (input.campaignServable === false) return { status: "paused", needsYou: null };
  if (input.unreadGuesses > 0) return { status: "needs_you", needsYou: `${input.unreadGuesses} ${input.unreadGuesses === 1 ? "field" : "fields"}` };
  const fixable = input.weekReasons.filter((row) => FIXABLE_REASONS.has(row.reasonCode));
  const fixableCount = fixable.reduce((sum, row) => sum + row.count, 0);
  if (input.week.posts >= 5 && fixableCount / input.week.posts >= 0.2) {
    return { status: "needs_you", needsYou: NEEDS_WORD[fixable[0].reasonCode] ?? "refusals" };
  }
  if (!input.everPosted) return { status: "waiting", needsYou: null };
  return { status: "live", needsYou: null };
}

/** "HH:MM" → minutes after midnight, or null. */
export function minutesOf(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** The weekday (0 Sunday) and minute of the day at `at` in `timeZone`. */
export function zonedClock(at: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day: day < 0 ? 0 : day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** True when a post at `at` falls inside the hours. No hours (null) means any time. */
export function withinPostingHours(hours: PostingHours | null | undefined, at: Date): boolean {
  if (!hours) return true;
  const start = minutesOf(hours.start);
  const end = minutesOf(hours.end);
  if (start === null || end === null || !Array.isArray(hours.days)) return true;
  let clock: { day: number; minute: number };
  try {
    clock = zonedClock(at, hours.timeZone || "America/Chicago");
  } catch {
    return true;
  }
  if (!hours.days.includes(clock.day)) return false;
  return start <= end ? clock.minute >= start && clock.minute < end : clock.minute >= start || clock.minute < end;
}

/** Read stored hours tolerantly; anything malformed is "any time". */
export function readPostingHours(value: unknown): PostingHours | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const days = Array.isArray(raw.days) ? raw.days.filter((day): day is number => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6) : [];
  const start = typeof raw.start === "string" ? raw.start : "";
  const end = typeof raw.end === "string" ? raw.end : "";
  const timeZone = typeof raw.timeZone === "string" && raw.timeZone ? raw.timeZone : "America/Chicago";
  if (minutesOf(start) === null || minutesOf(end) === null || days.length === 0) return null;
  return { days: [...new Set(days)].sort(), start, end, timeZone };
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const clock12 = (value: string) => {
  const minutes = minutesOf(value) ?? 0;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour < 12 ? "am" : "pm";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return minute ? `${h}:${String(minute).padStart(2, "0")} ${suffix}` : `${h} ${suffix}`;
};

/** "Mon–Sat · 8 am – 8 pm", or "Any time". */
export function describeHours(hours: PostingHours | null): string {
  if (!hours) return "Any time";
  const days = hours.days;
  const run = days.length > 1 && days.every((day, index) => index === 0 || day === days[index - 1] + 1);
  const dayText = days.length === 7 ? "Every day" : run ? `${DAY[days[0]]}–${DAY[days[days.length - 1]]}` : days.map((day) => DAY[day]).join(", ");
  return `${dayText} · ${clock12(hours.start)} – ${clock12(hours.end)}`;
}

/**
 * The UTC instant the viewer's day began, for "today" counts. Falls back to UTC midnight for an
 * unknown zone.
 */
export function startOfDayIn(timeZone: string, now: Date = new Date()): Date {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const offset = asUtc - Math.floor(now.getTime() / 1000) * 1000;
    return new Date(Date.UTC(get("year"), get("month") - 1, get("day")) - offset);
  } catch {
    const day = new Date(now);
    day.setUTCHours(0, 0, 0, 0);
    return day;
  }
}

/** "Martha R. · TX" from a mapped payload: the least a person needs to recognise a refused lead. */
export function leadLabel(values: Record<string, unknown>): string {
  const word = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  let first = word(values.first_name);
  let last = word(values.last_name);
  if (!first && !last) {
    const parts = word(values.full_name).split(/\s+/).filter(Boolean);
    first = parts[0] ?? "";
    last = parts.length > 1 ? parts[parts.length - 1] : "";
  }
  const name = [first, last ? `${last[0].toUpperCase()}.` : ""].filter(Boolean).join(" ");
  const state = word(values.state).toUpperCase();
  return [name || "No name", /^[A-Z]{2}$/.test(state) ? state : ""].filter(Boolean).join(" · ");
}

/** Plain words for a refusal, as the board writes them ("Invalid phone", "Already in the system"). */
export const REASON_WORDS: Record<string, string> = {
  duplicate: "Already in the system",
  suppressed_litigator: "Known TCPA litigator",
  suppressed_internal: "On your do-not-call list",
  suppressed_dnc: "On Do Not Call",
  invalid_phone: "Invalid phone",
  missing_required_field: "No name",
  unknown_state: "No state",
  campaign_not_accepting: "Campaign not taking leads",
  scrub_unavailable: "Scrub was down",
  rate_limited: "Posting too fast",
  unauthorised: "Key not valid",
  missing_consent_text: "No consent words",
  missing_consent_ip: "No consent IP",
  invalid_date_of_birth: "Unreadable birth date",
  state_not_licensed: "State not licensed",
  daily_cap_reached: "Daily cap reached",
  outside_posting_hours: "Outside posting hours",
};

/** Red where the lead itself is unusable; amber where the post could succeed later; grey where it is the scrub working. */
export const REASON_CHIP: Record<string, "danger" | "warning" | "neutral"> = {
  invalid_phone: "danger",
  missing_required_field: "danger",
  unknown_state: "danger",
  missing_consent_text: "warning",
  missing_consent_ip: "warning",
  invalid_date_of_birth: "warning",
  state_not_licensed: "warning",
  campaign_not_accepting: "warning",
  unauthorised: "danger",
  suppressed_dnc: "danger",
  suppressed_litigator: "danger",
  suppressed_internal: "danger",
  duplicate: "neutral",
  scrub_unavailable: "neutral",
  rate_limited: "neutral",
  daily_cap_reached: "neutral",
  outside_posting_hours: "neutral",
};

/** What a refusal asks of the owner: one fix, or nothing ("working as meant"). */
export type ReasonFix =
  | { kind: "map"; label: string }
  | { kind: "licence"; label: string; href: string }
  | { kind: "campaign"; label: string; href: string }
  | { kind: "rotate"; label: string }
  | { kind: "tell"; label: string }
  | { kind: "none"; label: string };

export function fixForReason(reasonCode: string, campaignId: string | null): ReasonFix {
  switch (reasonCode) {
    case "invalid_phone":
    case "unknown_state":
    case "missing_required_field":
    case "invalid_date_of_birth":
      return { kind: "map", label: "Fix field map" };
    case "missing_consent_text":
    case "missing_consent_ip":
      return { kind: "tell", label: "Tell vendor" };
    case "state_not_licensed":
      return { kind: "licence", label: "Add a licence", href: "/app/settings#contracting" };
    case "campaign_not_accepting":
      return { kind: "campaign", label: "Open the campaign", href: campaignId ? `/app/campaigns/${campaignId}` : "/app/campaigns" };
    case "unauthorised":
      return { kind: "rotate", label: "Rotate the key" };
    case "suppressed_dnc":
    case "suppressed_litigator":
    case "suppressed_internal":
      return { kind: "none", label: "Working as meant" };
    case "duplicate":
      return { kind: "none", label: "Duplicate within your leads" };
    case "rate_limited":
      return { kind: "tell", label: "Tell vendor" };
    default:
      return { kind: "none", label: "Nothing to fix" };
  }
}

/** Dollars from cents, always two places: "$22.00". */
export function dollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whole dollars for a figure: "$2,482". */
export function wholeDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** "$15.00" or "15" → 1500; empty → null; anything else → NaN. */
export function centsFromInput(text: string): number | null {
  const raw = text.replace(/[$,\s]/g, "");
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return Number.NaN;
  return Math.round(Number(raw) * 100);
}

/** "snake_case" product code → "Snake case". */
export function productWords(code: string | null): string {
  if (!code) return "No product";
  const text = code.replace(/[_-]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "No product";
}

/** A callback address we will call from our servers: https, a real host name, never a private address. */
export function callbackUrlProblem(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "Enter a full address starting with https://";
  }
  if (url.protocol !== "https:") return "The address must start with https://";
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host.startsWith("[") ||
    !host.includes(".")
  ) {
    return "Use the vendor's public address, not a private or local one.";
  }
  if (text.length > 500) return "That address is too long.";
  return null;
}

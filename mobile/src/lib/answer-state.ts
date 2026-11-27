/**
 * What a refused or failed answer means for the screen (board section 13). Read from the server's own
 * status and code, never guessed from the words:
 *
 *   offline   no answer at all (fetch failed, ApiError status 0) — L4, the small mark in the bar
 *   paused    the agency is suspended (tenant_suspended) or can only read (read_only,
 *             maintenance_read_only, maintenance_locked) — M6
 *   plan      the agency's plan lacks the feature (feature_not_entitled) — M4
 *   role      this person's role may not open it (role_not_allowed), or staff switched it off for the
 *             agency (feature_disabled_for_tenant) — M4, without the plan wording
 *   failed    anything else — M3, with the server's words and Try again
 */
export type AnswerState = "offline" | "paused" | "plan" | "role" | "failed";

export const PAUSED_CODES = ["tenant_suspended", "read_only", "maintenance_read_only", "maintenance_locked"] as const;

export function answerState(err: { status: number; code: string | null } | null | undefined): AnswerState | null {
  if (!err) return null;
  if (err.status === 0) return "offline";
  if (err.code && (PAUSED_CODES as readonly string[]).includes(err.code)) return "paused";
  if (err.code === "feature_not_entitled") return "plan";
  if (err.code === "role_not_allowed" || err.code === "feature_disabled_for_tenant") return "role";
  return "failed";
}

/**
 * M8 · the server says this version of the app can no longer talk to it: HTTP 426 Upgrade Required, or
 * the code `app_update_required`. (No route sends either yet; the app is ready for the day one does.)
 */
export function needsUpdate(err: { status: number; code: string | null } | null | undefined): boolean {
  return Boolean(err && (err.status === 426 || err.code === "app_update_required"));
}

/** "21:00" → "9:00 pm" (the board writes times this way). */
export function clockWords(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** A chat row's time: "2:12" today, "Mon" this week, "12 Nov" before (board H2). */
export function chatTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days <= 0) {
    const hour = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
    return `${hour}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (days < 7) return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
  return `${d.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}`;
}

/** "First Last" ⇄ the two board fields; the server keeps one name, so the split is only for editing. */
export function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function joinName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter(Boolean).join(" ");
}

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** "three places" (board A7); numerals past ten. */
export function countWords(n: number, noun: string): string {
  return `${NUMBER_WORDS[n] ?? String(n)} ${noun}${n === 1 ? "" : "s"}`;
}

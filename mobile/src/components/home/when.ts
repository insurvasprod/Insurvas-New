/**
 * Dates and clock times as the board writes them ("Tuesday 24 November", "24 Dec", "11:30 am").
 * Built by hand rather than with Intl so iOS, Android (Hermes) and Jest print the same words.
 */
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Tuesday 24 November" (board B1 header). */
export function longDate(d = new Date()): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "24 Dec" (board A2 trust line). */
export function dayMonth(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

/** "11:30 am" in the phone's own clock. */
export function clock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "am" : "pm"}`;
}

/** "11:30" — the right-hand time on a schedule row (board B1). */
export function clockShort(d: Date): string {
  return clock(d).replace(/ [ap]m$/, "");
}

/** The time part of a server time like "Nov 24, 2026, 10:30 AM" → "10:30 am". */
export function timePart(serverTime: string | null): string | null {
  if (!serverTime) return null;
  const m = /(\d{1,2}:\d{2})\s*([AP]M)\s*$/i.exec(serverTime.trim());
  return m ? `${m[1]} ${m[2].toLowerCase()}` : null;
}

/** "2 h overdue" from the scheduled time. */
export function overdueLabel(iso: string, now = Date.now()): string {
  const min = Math.max(1, Math.floor((now - Date.parse(iso)) / 60_000));
  if (min < 60) return `${min} min overdue`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h overdue` : `${Math.floor(h / 24)} d overdue`;
}

/** "0:48" — minutes and seconds. */
export function minSec(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Up to two initials from a name, else from the email. */
export function initialsOf(name: string | null | undefined, email?: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email ?? "?").slice(0, 2).toUpperCase();
}

/**
 * The ready card's calling-window line (board B1): "Calling window open in 31 states · closes 9:00 pm ET",
 * or, when every state is closed, when the first opens again. Null when the server sent nothing.
 */
export function windowLine(now: { openStates: number; closesAt: string | null; opensAt: string | null } | null | undefined): { text: string; open: boolean } | null {
  if (!now) return null;
  if (now.openStates > 0) {
    const states = `${now.openStates} ${now.openStates === 1 ? "state" : "states"}`;
    return { open: true, text: `Calling window open in ${states}${now.closesAt ? ` · closes ${now.closesAt}` : ""}` };
  }
  return { open: false, text: now.opensAt ? `Calling window closed · opens ${now.opensAt}` : "Calling window closed for today" };
}

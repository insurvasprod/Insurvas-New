/**
 * "18 seconds ago", as the submit board reads a draft save and a phone screen. Counts up in whole
 * units and says "just now" for the first few seconds, so a fresh save never reads "0 seconds".
 */
export function agoLabel(then: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// A fixed month list rather than toLocaleDateString: the browser's locale data spells September
// "Sept" in some builds, and the boards draw three letters everywhere.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2 Aug", with the year only when it is not this one. Read in the viewer's own time zone. */
export function dayMonth(date: Date, now: Date): string {
  const label = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === now.getFullYear() ? label : `${label} ${date.getFullYear()}`;
}

/** "24 Sep 09:00", 24-hour, as the team board dates an invitation's expiry. */
export function dayMonthTime(date: Date, now: Date): string {
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${dayMonth(date, now)} ${time}`;
}

/**
 * "12 min ago", "1 hr ago", "2 days ago", then a date: the team table's Last activity column.
 * Shorter than agoLabel because it sits in a column, and a week-old sign-in is a date, not a count.
 */
export function activityLabel(then: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  return dayMonth(new Date(then), new Date(now));
}

/** "expires in 2 days" — how long the soonest open invitation has left. */
export function expiresInLabel(at: number, now: number): string {
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes <= 0) return "expired";
  if (minutes < 60) return "expires within the hour";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "expires in 1 hour" : `expires in ${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "expires in 1 day" : `expires in ${days} days`;
}

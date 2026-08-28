const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "2 hours ago" / "Never" (SA-1.5). Never is returned as a distinct string rather than a dash
 * so "hasn't logged in yet" reads differently from "logged in long ago", which the acceptance
 * criteria explicitly ask for.
 */
export function relativeTime(value: string | null): string {
  if (!value) return "Never";

  const diff = Date.now() - new Date(value).getTime();
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) {
    const mins = Math.floor(diff / MINUTE);
    return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (diff < 30 * DAY) {
    const days = Math.floor(diff / DAY);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  // Past a month, an exact date is more useful than "14 months ago".
  return new Date(value).toLocaleDateString();
}

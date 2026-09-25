/** "oldest 6 days" — how long the longest-waiting open submission has waited. */
export function oldestOpenLabel(stillOpen: number, oldestOpenAt: string | null | undefined, now: number) {
  if (stillOpen === 0) return "nothing open";
  if (!oldestOpenAt) return "not yet resolved";
  const hours = Math.max(0, (now - new Date(oldestOpenAt).getTime()) / 3_600_000);
  if (hours < 1) return "oldest under an hour";
  if (hours < 24) return `oldest ${Math.floor(hours)} ${Math.floor(hours) === 1 ? "hour" : "hours"}`;
  const days = Math.floor(hours / 24);
  return `oldest ${days} ${days === 1 ? "day" : "days"}`;
}

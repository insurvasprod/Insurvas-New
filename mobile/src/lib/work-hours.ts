/**
 * Settings › Working hours (board J3: "8:30 am – 6 pm ET"): today's hours from /api/app/availability
 * (the person's own member row: weekday 0 = Sunday, "HH:MM" times, an IANA zone). Pure, so it is tested.
 */
export type WorkingHours = { weekday: number; startTime: string; endTime: string };

const ZONES: Record<string, string> = {
  "America/New_York": "ET", "America/Detroit": "ET", "America/Indiana/Indianapolis": "ET", "America/Kentucky/Louisville": "ET",
  "America/Chicago": "CT", "America/North_Dakota/Center": "CT", "America/Denver": "MT", "America/Boise": "MT", "America/Phoenix": "MT",
  "America/Los_Angeles": "PT", "America/Anchorage": "AKT", "America/Adak": "HT", "Pacific/Honolulu": "HT", "America/Puerto_Rico": "AT",
};

/** "08:30" → "8:30 am", "18:00" → "6 pm". */
export function hourWords(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const half = h % 24 < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${half}` : `${h12} ${half}`;
}

/** Today's working hours as the board writes them, or "Off today" / null when none are set at all. */
export function hoursToday(hours: WorkingHours[], timezone: string | null, weekday: number): string | null {
  if (!hours.length) return null;
  const today = hours.filter((h) => h.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime));
  if (!today.length) return "Off today";
  const zone = timezone ? ZONES[timezone] ?? null : null;
  return `${today.map((h) => `${hourWords(h.startTime)} – ${hourWords(h.endTime)}`).join(", ")}${zone ? ` ${zone}` : ""}`;
}

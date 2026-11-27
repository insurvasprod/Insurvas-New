/**
 * Board B3 · Home for a setter: the week's bookings against the weekly target, and today's numbers.
 * Built from the setter's own scorecard rows (GET /api/app/scorecard?days=30: one row per day) and the
 * `booked` goal (GET /api/app/goals?kind=booked&for=me). Weeks start on Monday. Pure, so it is tested.
 */
export type ScoreRow = { userId: string; day: string; dials: number; contacts: number; booked: number; showed: number; noShow: number };
export type GoalAnswer = { goal: { state: "set"; target: number } | { state: "none" } | { state: "missing" } };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

/** ISO 8601 week number ("Week 48"). */
export function weekNumber(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export type SetterWeek = {
  week: number;
  target: number | null;
  booked: number;
  toGo: number | null;
  yesterdayBooked: number;
  lastWeekShowed: number;
  today: { dials: number; contacts: number; booked: number };
  /** Showed of those closed out (showed + no-show) over the rows given; null with none closed out. */
  showRatePct: number | null;
};

export function setterWeek(rows: ScoreRow[], goal: GoalAnswer | null, now = new Date()): SetterWeek {
  const day = (r: ScoreRow) => r.day.slice(0, 10);
  const monday = mondayOf(now);
  const lastMonday = new Date(monday);
  lastMonday.setDate(monday.getDate() - 7);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const [thisWeek, lastWeek, today, yest] = [iso(monday), iso(lastMonday), iso(now), iso(yesterday)];
  const sum = (list: ScoreRow[], key: "dials" | "contacts" | "booked" | "showed" | "noShow") => list.reduce((n, r) => n + (Number(r[key]) || 0), 0);
  const booked = sum(rows.filter((r) => day(r) >= thisWeek), "booked");
  const todays = rows.filter((r) => day(r) === today);
  const closed = sum(rows, "showed") + sum(rows, "noShow");
  const target = goal?.goal.state === "set" ? goal.goal.target : null;
  return {
    week: weekNumber(now),
    target,
    booked,
    toGo: target === null ? null : Math.max(0, target - booked),
    yesterdayBooked: sum(rows.filter((r) => day(r) === yest), "booked"),
    lastWeekShowed: sum(rows.filter((r) => day(r) >= lastWeek && day(r) < thisWeek), "showed"),
    today: { dials: sum(todays, "dials"), contacts: sum(todays, "contacts"), booked: sum(todays, "booked") },
    showRatePct: closed ? Math.round((sum(rows, "showed") / closed) * 100) : null,
  };
}

/** The ring card's two lines (board B3: "7 to go this week" / "You set 4 yesterday. 2 of last week’s showed up."). */
export function setterLines(w: SetterWeek): { title: string; body: string } {
  const title = w.toGo === null ? `${w.booked} set this week` : w.toGo > 0 ? `${w.toGo} to go this week` : "Weekly target reached";
  const body = `You set ${w.yesterdayBooked} yesterday. ${w.lastWeekShowed} of last week’s showed up.`;
  return { title, body };
}

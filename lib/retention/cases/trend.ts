/**
 * The small charts in Retention › Scorecard's and Results' cards (Reports round 7, owner pick 0·C, 2026-11-11: the
 * cards stay, each with a sparkline over the same figure). From the same `retention_case` rows the cards count, a
 * point a week (a month over half a year): cases open at the week's end, saves and losses closed in the week, and the
 * save rate so far (saved ÷ saved + lost, every case closed in the period up to then). Pure.
 */

export type TrendCase = { status: string; openedAt: string; resolvedAt: string | null };
export type CaseTrend = { ends: string[]; open: number[]; saved: number[]; lost: number[]; rate: number[] };

const DAY = 86_400_000;

/**
 * `since` is the period's first day (ISO date), null for all time (from the oldest case opened); `today` an ISO date.
 * Weekly buckets up to about six months, 30-day buckets past it, ending today, oldest first. The rate has a point only
 * from the first bucket with a decided case, as a whole percentage.
 */
export function caseTrend(cases: readonly TrendCase[], since: string | null, today: string): CaseTrend {
  const end = Date.parse(`${today}T00:00:00Z`) + DAY;
  const oldest = cases.reduce((min, c) => Math.min(min, Date.parse(c.openedAt)), end);
  const start = since ? Date.parse(`${since}T00:00:00Z`) : oldest;
  const span = Math.max(DAY, end - start);
  const step = span <= 190 * DAY ? 7 * DAY : 30 * DAY;
  const count = Math.max(1, Math.min(60, Math.ceil(span / step)));
  const ends = Array.from({ length: count }, (_, i) => end - (count - 1 - i) * step);
  const open = ends.map(() => 0);
  const saved = ends.map(() => 0);
  const lost = ends.map(() => 0);
  const firstStart = ends[0] - step;
  for (const c of cases) {
    const opened = Date.parse(c.openedAt);
    const resolved = c.resolvedAt ? Date.parse(c.resolvedAt) : null;
    ends.forEach((at, i) => {
      if (opened < at && (resolved === null || resolved >= at)) open[i]++;
    });
    if (resolved === null || resolved < firstStart || resolved >= end) continue;
    const at = Math.min(count - 1, Math.floor((resolved - firstStart) / step));
    if (c.status === "saved") saved[at]++;
    else if (c.status === "lost") lost[at]++;
  }
  const rate: number[] = [];
  let s = 0;
  let l = 0;
  for (let i = 0; i < count; i++) {
    s += saved[i];
    l += lost[i];
    if (s + l > 0) rate.push(Math.round((s / (s + l)) * 100));
  }
  return { ends: ends.map((at) => new Date(at - DAY).toISOString().slice(0, 10)), open, saved, lost, rate };
}

/**
 * Cash this month (mobile board B6, the bookkeeper's Home): the money that landed in the agency's bank accounts this
 * month, week by week. Read from the deposits the agency imported (bank_transaction, amount_cents > 0), the same rows
 * Bank deposits lists; nothing is estimated. A week runs Monday to Sunday and is cut at the month's edges and at
 * `through` (today), so the bars always add up to the month's total.
 */

const DAY = 86_400_000;

export type DepositWeek = { from: string; to: string; cents: number };
export type DepositWeeks = { month: string; from: string; through: string; totalCents: number; count: number; weeks: DepositWeek[] };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isMonth = (v: string | null | undefined): v is string => typeof v === "string" && MONTH.test(v);
export const isDate = (v: string | null | undefined): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** The month's first and last day, and the last day counted: `today` when it falls inside the month, else the month's end. */
export function monthSpan(month: string, today?: string | null): { from: string; to: string; through: string } {
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const through = today && isDate(today) && today >= from && today <= to ? today : to;
  return { from, to, through };
}

/** Monday-to-Sunday weeks from the 1st to `through`, each cut to the month. */
export function weeksOf(from: string, through: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let start = from;
  while (start <= through) {
    // getUTCDay: 0 Sunday … 6 Saturday; days left to Sunday.
    const dow = new Date(`${start}T00:00:00Z`).getUTCDay();
    const end = shift(start, dow === 0 ? 0 : 7 - dow);
    out.push({ from: start, to: end < through ? end : through });
    start = shift(end, 1);
  }
  return out;
}

/** Each week's deposits and the month's total, from the deposit rows (posted day and amount in cents). */
export function depositWeeks(month: string, today: string | null | undefined, rows: readonly { posted_on: string; amount_cents: number }[]): DepositWeeks {
  const span = monthSpan(month, today);
  const weeks: DepositWeek[] = weeksOf(span.from, span.through).map((w) => ({ ...w, cents: 0 }));
  let total = 0;
  let count = 0;
  for (const row of rows) {
    const day = String(row.posted_on).slice(0, 10);
    const cents = Number(row.amount_cents);
    if (!(cents > 0) || day < span.from || day > span.through) continue;
    const week = weeks.find((w) => day >= w.from && day <= w.to);
    if (!week) continue;
    week.cents += cents;
    total += cents;
    count += 1;
  }
  return { month, from: span.from, through: span.through, totalCents: total, count, weeks };
}

export type PayoutPeriod = { from: string; to: string };

const dateText = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

const monthEnd = (isoDate: string) => {
  const [year, month] = isoDate.split("-").map(Number);
  return dateText(new Date(Date.UTC(year!, month!, 0)));
};

/**
 * Start with the last complete month when it has terms. For a new partner whose first rate starts
 * later, start on that effective date so the draft opens on a period the pricing rules can use.
 */
export function defaultPayoutPeriod(firstTermDate: string | null, now = new Date()): PayoutPeriod {
  const lastMonthStart = dateText(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const lastMonthEnd = dateText(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));

  if (!firstTermDate || firstTermDate <= lastMonthStart) {
    return { from: lastMonthStart, to: lastMonthEnd };
  }

  if (firstTermDate <= lastMonthEnd) {
    return { from: firstTermDate, to: lastMonthEnd };
  }

  return { from: firstTermDate, to: monthEnd(firstTermDate) };
}

/** Every day in a run needs a rate in force; partner terms continue until superseded. */
export function periodHasTerms(firstTermDate: string | null, from: string, to: string): boolean {
  return Boolean(firstTermDate && from >= firstTermDate && from <= to);
}

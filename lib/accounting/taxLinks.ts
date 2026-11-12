/**
 * Tax summaries, round 7 (owner 2026-11-10, docs/la4/mockups-r7/accounting.html §6 · A): the pure rules the list and
 * a payee's page share, so the server page and the client board agree on who is in which chip, the order the ‹ ›
 * walk, and the year by quarter. No imports at run time: the node tests load it as it is.
 */

/** The Contractors chips; each strip tile opens one of them. "under" lists the payees under the threshold. */
export const TAX_WHO = ["all", "missing", "ready", "under"] as const;
export type TaxWho = (typeof TAX_WHO)[number];
export const TAX_WHO_LABELS: Record<TaxWho, string> = { all: "All", missing: "Missing details", ready: "Ready", under: "Under the threshold" };

/** The payee page's tabs (`?tab=`). */
export const PAYEE_TABS = ["details", "payments", "w9"] as const;
export type PayeeTab = (typeof PAYEE_TABS)[number];

type Standing = { missing: string[]; exempt: string | null };
type Keyed = { payeeType: string; payeeId: string };
type Lists<R> = { rows: readonly R[]; under: readonly R[] };

export const whoOf = (value: string | null | undefined): TaxWho => TAX_WHO.find((w) => w === value) ?? "all";
export const payeeTabOf = (value: string | null | undefined): PayeeTab => PAYEE_TABS.find((t) => t === value) ?? "details";

/** Where a payee stands for January: missing something the 1099 needs, or ready. */
export function standing(r: Standing): "missing" | "ready" {
  return r.missing.length && !r.exempt ? "missing" : "ready";
}

/** The payees a chip lists, in the list's order (most paid first). */
export function whoRows<R extends Standing>(c: Lists<R>, who: TaxWho): R[] {
  if (who === "under") return [...c.under];
  if (who === "all") return [...c.rows];
  return c.rows.filter((r) => standing(r) === who);
}

/** The "Next step" column, in words; the step itself is taken on the payee's page. */
export function nextStepWords(r: Standing, under = false): string {
  if (under) return "No 1099 needed";
  if (r.exempt) return "No 1099 needed";
  if (!r.missing.length) return "Ready for January";
  if (r.missing.length > 1) return "Add the details";
  return `Add the ${r.missing[0]}`;
}

export const payeeKey = (r: Keyed) => `${r.payeeType}/${r.payeeId}`;

/** A payee's page: the year, the list it was opened from (for its ‹ ›) and the tab. */
export function payeeHref(r: Keyed, year: number, opts: { from?: TaxWho; tab?: PayeeTab } = {}): string {
  const p = new URLSearchParams({ year: String(year) });
  if (opts.from && opts.from !== "all") p.set("from", opts.from);
  if (opts.tab && opts.tab !== "details") p.set("tab", opts.tab);
  return `/app/tax/payee/${r.payeeType}/${r.payeeId}?${p}`;
}

/** The list a payee's ‹ › walk: the chip it was opened from, or the one it is in when that chip does not hold it. */
export function stepperList<R extends Standing & Keyed>(c: Lists<R>, from: TaxWho, key: string): { who: TaxWho; rows: R[] } {
  const asked = whoRows(c, from);
  if (asked.some((r) => payeeKey(r) === key)) return { who: from, rows: asked };
  const own: TaxWho = c.under.some((r) => payeeKey(r) === key) ? "under" : "all";
  return { who: own, rows: whoRows(c, own) };
}

/** The next payee missing something after this one (wrapping round), never this one: the save toast's "Next missing ›". */
export function nextMissing<R extends Standing & Keyed>(c: Lists<R>, key: string): R | null {
  const missing = whoRows(c, "missing");
  const at = missing.findIndex((r) => payeeKey(r) === key);
  const order = at < 0 ? missing : [...missing.slice(at + 1), ...missing.slice(0, at)];
  return order.find((r) => payeeKey(r) !== key) ?? null;
}

// ─── By category, by quarter ─────────────────────────────────────────────────────────────────────

export type TaxQuarter = { n: 1 | 2 | 3 | 4; from: string; to: string; label: string; state: "closed" | "so_far" | "future" };

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar quarters of a year as half-open ranges [from, to); the one holding `today` is "so far", later ones have not happened. */
export function taxQuarters(year: number, today: string): TaxQuarter[] {
  return ([1, 2, 3, 4] as const).map((n) => {
    const from = `${year}-${pad((n - 1) * 3 + 1)}-01`;
    const to = n === 4 ? `${year + 1}-01-01` : `${year}-${pad(n * 3 + 1)}-01`;
    const state = today >= to ? "closed" : today >= from ? "so_far" : "future";
    return { n, from, to, label: state === "so_far" ? `Q${n} so far` : `Q${n}`, state };
  });
}

export type QuarterTotal = { taxCategory: string; amountCents: number };
export type CategoryByQuarter<C extends string = string> = { category: C; quarters: (number | null)[]; yearCents: number };

/**
 * Each category's four quarters and the year (their sum). `perQuarter[i]` is quarter i's rows, or null for a quarter
 * that has not started (shown as a dash, never $0.00). Categories come in `order`; one with no rows at all is left out.
 */
export function categoriesByQuarter<C extends string>(perQuarter: readonly (readonly QuarterTotal[] | null)[], order: readonly C[]): CategoryByQuarter<C>[] {
  const sums = new Map<string, (number | null)[]>();
  perQuarter.forEach((rows, i) => {
    for (const r of rows ?? []) {
      const cells = sums.get(r.taxCategory) ?? perQuarter.map((q) => (q ? 0 : null));
      cells[i] = (cells[i] ?? 0) + r.amountCents;
      sums.set(r.taxCategory, cells);
    }
  });
  return order.filter((k) => sums.has(k)).map((category) => {
    const quarters = sums.get(category)!;
    return { category, quarters, yearCents: quarters.reduce<number>((t, c) => t + (c ?? 0), 0) };
  });
}

// The client comparison's words (LA-3.5 print view; board l3-quotes-print). Pure and dependency
// free so the tests can read it. Everything here is said to the client in plain words from the real
// quotes: what it costs, what it pays and when. It never states a carrier-specific rule it does not
// know — a reduced early payout is described, and "the policy sets out exactly how much".

export type PrintQuote = {
  id: string;
  carrierName: string;
  productLabel: string;
  tier: string;
  faceAmountCents: number;
  monthlyPremiumCents: number;
  annualPremiumCents: number | null;
  termLength: number | null;
  /** Final expense / whole life: the price never goes up and the coverage never runs out. */
  wholeLife: boolean;
};

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export const numberWord = (n: number) => WORDS[n] ?? String(n);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** $15,000 — face amounts read in whole dollars. */
export const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export function ordinal(n: number) {
  const rem = n % 100;
  const suffix = rem >= 11 && rem <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

const sameFace = (quotes: PrintQuote[]) => quotes.length > 0 && quotes.every((q) => q.faceAmountCents === quotes[0].faceAmountCents);

/** "Three ways to cover $15,000"; "Two coverage options" when the amounts differ. */
export function headline(quotes: PrintQuote[]) {
  const n = quotes.length;
  if (n === 0) return "Your coverage options";
  if (sameFace(quotes)) return `${capital(numberWord(n))} ${n === 1 ? "way" : "ways"} to cover ${dollars(quotes[0].faceAmountCents)}`;
  return `${capital(numberWord(n))} coverage ${n === 1 ? "option" : "options"}`;
}

/** The paragraph under the headline. `name` is how the insured is referred to ("Grace"). */
export function intro(quotes: PrintQuote[], name: string) {
  const n = quotes.length;
  if (n === 0) return "";
  const allWhole = quotes.every((q) => q.wholeLife);
  const allTerm = quotes.every((q) => q.termLength);
  if (allWhole && n === 1) return `It pays ${dollars(quotes[0].faceAmountCents)} and is whole life, so the price never goes up and the coverage never runs out.`;
  if (allWhole && sameFace(quotes)) {
    const w = numberWord(n);
    const tiersDiffer = new Set(quotes.map((q) => q.tier)).size > 1;
    return `All ${w} pay the same ${dollars(quotes[0].faceAmountCents)} and all ${w} are whole life, so the price never goes up and the coverage never runs out. ${tiersDiffer ? `They differ in what happens if ${name} passes in the first two years.` : "They differ in the monthly price."}`;
  }
  if (allWhole) return "All of them are whole life, so the price never goes up and the coverage never runs out. They differ in how much they pay and what they cost.";
  if (allTerm) return `Each option pays its full amount if ${name} passes during its term. They differ in how long the term is and what it costs.`;
  return "Each option below shows what it costs each month and what it pays.";
}

export type WhatItPays = { firstLabel: string; first: string; afterLabel: string; after: string };

/** What the policy pays, early and later, in plain words. */
export function whatItPays(q: PrintQuote, name: string): WhatItPays {
  const amount = dollars(q.faceAmountCents);
  if (q.termLength) {
    return {
      firstLabel: `If ${name} passes during the ${q.termLength} years`,
      first: `The full ${amount}.`,
      afterLabel: `After ${q.termLength} years`,
      after: "The coverage ends. The policy says whether it can be renewed or changed to a permanent policy.",
    };
  }
  const firstLabel = `If ${name} passes in the first two years`;
  const afterLabel = "After two years";
  const after = `The full ${amount}.`;
  switch (q.tier) {
    case "level": return { firstLabel, first: `The full ${amount}, from the first day.`, afterLabel, after };
    case "graded": return { firstLabel, first: `Part of the ${amount}, not all of it. The policy sets out exactly how much.`, afterLabel, after };
    case "modified": return { firstLabel, first: `A limited amount, not the full ${amount}. The policy sets out exactly how much.`, afterLabel, after };
    case "gi": return { firstLabel, first: `Less than the full ${amount} — no health questions are asked, so the early payout is limited. The policy sets out exactly how much.`, afterLabel, after };
    default: return { firstLabel, first: "The policy sets out exactly what it pays.", afterLabel, after };
  }
}

/** One short line comparing this quote with the others on the sheet, or null when there is nothing true to say. */
export function comparisonNote(q: PrintQuote, all: PrintQuote[]): string | null {
  if (all.length < 2) return null;
  const prices = all.map((x) => x.monthlyPremiumCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return null;
  const w = numberWord(all.length);
  const unique = (v: number) => prices.filter((p) => p === v).length === 1;
  const anyLevel = all.some((x) => !x.termLength && x.tier === "level");
  const anyReduced = all.some((x) => !x.termLength && x.tier !== "level");
  if (q.monthlyPremiumCents === min && unique(min)) return `The lowest monthly payment of the ${w}.`;
  if (q.monthlyPremiumCents === max && unique(max)) {
    return !q.termLength && q.tier === "level" && anyReduced ? "Costs the most because it pays in full straight away." : `The highest monthly payment of the ${w}.`;
  }
  if (!q.termLength && q.tier !== "level" && anyLevel && all.some((x) => !x.termLength && x.tier === "level" && x.monthlyPremiumCents > q.monthlyPremiumCents)) {
    return "Cheaper each month, smaller payout in the first two years.";
  }
  return null;
}

/** "What happens next". The first-payment line only when a draft day is already set. */
export function nextSteps(name: string, draftDay: number | null) {
  const base = `Nothing is decided by this sheet. When ${name} picks one, the application is done on the phone: health questions, who the money goes to, and how the payment is made. The carrier then decides, and ${name} is told either way.`;
  return draftDay ? `${base} The first payment is set for the ${ordinal(draftDay)} of the month.` : base;
}

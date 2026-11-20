/**
 * Statement first (ledger-r1 board 3·A, owner pick 2026-11-19): what one commission statement says about the agency's
 * contract, read off the statement itself so a Ledger agent sees money after one upload and one confirm.
 *
 *   · the carrier: a Carrier column, else the file name, else the layout a carrier's statements were read with before;
 *   · the period: the line dates (a single month when they all sit in one), else last month;
 *   · the rate: the Rate column's commonest value, else paid ÷ premium on commission lines, else 100%;
 *   · the advance: paid ÷ (annual premium × rate) on the advance lines, whole percent, and its months as that share of
 *     a year (75% = 9 months), the way an advance of N months' commission is paid;
 *   · already wrong: lines paid at another rate (or advanced at another share) than the rest;
 *   · the policies: every policy number on the statement the book does not hold, with its insured, its annual premium
 *     (the Premium column, else worked back from what was paid) and its first line date.
 *
 * Pure and client-safe: the server reads the file and calls readFirstStatement; the page only shows the findings.
 */
import type { StatementLineKind } from "./statementConstants.ts";

export type FirstLine = {
  lineNumber: number;
  policyNumber: string | null;
  insuredName: string | null;
  amountCents: number | null;
  kind: StatementLineKind | null;
  lineDate: string | null;
  premiumCents: number | null;
  rateBp: number | null;
  error: string | null;
  /** The product cell, when the file has a Product or Plan column. */
  product?: string | null;
};

export type FirstCarrier = { id: string; code: string; name: string };
export type FirstProduct = { code: string; name: string };

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const alnum = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
const policyKey = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");

/** Words too common in carrier names to name one on their own. */
const GENERIC = new Set(["life", "insurance", "company", "national", "american", "america", "mutual", "financial", "group", "the", "of", "and", "co", "inc", "corp", "corporation", "assurance", "benefit", "benefits", "health", "general", "united", "security", "fidelity", "family", "fraternal", "association", "statement", "commission", "commissions", "report", "agent", "agency"]);

/** How strongly `text` names a carrier: 3 its whole name, 2 its code as a word, 1 its first distinctive word; 0 none. */
function nameScore(text: string, carrier: FirstCarrier): number {
  const joined = alnum(text);
  const tokens = new Set(words(text));
  const name = alnum(carrier.name);
  if (name.length >= 4 && joined.includes(name)) return 3;
  const code = carrier.code.toLowerCase();
  if (code.length >= 3 && !GENERIC.has(code) && tokens.has(code)) return 2;
  const distinctive = words(carrier.name).find((word) => word.length >= 4 && !GENERIC.has(word));
  return distinctive && tokens.has(distinctive) ? 1 : 0;
}

/** The one carrier `text` names best, or null when none does or two tie. */
function bestNamed(text: string, carriers: readonly FirstCarrier[]): FirstCarrier | null {
  let best: { carrier: FirstCarrier; score: number } | null = null;
  let tie = false;
  for (const carrier of carriers) {
    const score = nameScore(text, carrier);
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && carrier.name.length > best.carrier.name.length)) { tie = false; best = { carrier, score }; }
    else if (score === best.score && carrier.name.length === best.carrier.name.length) tie = true;
  }
  return best && !tie ? best.carrier : null;
}

export type CarrierGuess = { carrierId: string | null; from: "carrier column" | "file name" | "layout" | null };

/**
 * The statement's carrier. A Carrier column's commonest value first (the statement says so), then the file name, then
 * the layout: the one carrier whose remembered columns this file has.
 */
export function guessCarrier(input: { fileName: string; carriers: readonly FirstCarrier[]; carrierColumn?: readonly string[]; layouts?: ReadonlyArray<{ carrierId: string; headers: readonly string[] }>; headers?: readonly string[] }): CarrierGuess {
  const values = mostCommon((input.carrierColumn ?? []).map((value) => value.trim()).filter(Boolean));
  if (values) {
    const named = bestNamed(values.value, input.carriers);
    if (named) return { carrierId: named.id, from: "carrier column" };
  }
  const fromName = bestNamed(input.fileName.replace(/\.[a-z0-9]+$/i, ""), input.carriers);
  if (fromName) return { carrierId: fromName.id, from: "file name" };
  const headers = new Set(input.headers ?? []);
  const fits = (input.layouts ?? []).filter((layout) => layout.headers.length > 0 && layout.headers.every((header) => headers.has(header)) && input.carriers.some((carrier) => carrier.id === layout.carrierId));
  const ids = [...new Set(fits.map((layout) => layout.carrierId))];
  if (ids.length === 1) return { carrierId: ids[0], from: "layout" };
  return { carrierId: null, from: null };
}

/** The commonest value and how many times it appears; ties go to the one seen first. */
export function mostCommon<T>(values: readonly T[]): { value: T; count: number } | null {
  const counts = new Map<T, number>();
  let best: { value: T; count: number } | null = null;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (!best || count > best.count) best = { value, count };
  }
  return best;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");

export type FoundPeriod = { start: string; end: string; from: "line dates" | "last month" };

/** The period the statement covers: one whole month when every line date sits in it, else first to last date. */
export function statementPeriodOf(lines: readonly FirstLine[], today: string): FoundPeriod {
  const dates = lines.filter((line) => !line.error && line.lineDate).map((line) => line.lineDate as string).sort();
  if (dates.length === 0) {
    const [y, m] = today.split("-").map(Number);
    const year = m === 1 ? y - 1 : y;
    const month = m === 1 ? 12 : m - 1;
    return { start: `${year}-${pad(month)}-01`, end: monthEnd(year, month), from: "last month" };
  }
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first.slice(0, 7) === last.slice(0, 7)) {
    const [y, m] = first.split("-").map(Number);
    return { start: `${first.slice(0, 7)}-01`, end: monthEnd(y, m), from: "line dates" };
  }
  return { start: first, end: last, from: "line dates" };
}

/** "October 2026" for a whole month, else "3 Oct 2026 – 28 Nov 2026". */
export function periodLabel(start: string, end: string): string {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me] = end.split("-").map(Number);
  if (ds === 1 && ys === ye && ms === me && end === monthEnd(ye, me)) return `${MONTHS[ms - 1]} ${ys}`;
  const day = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
  };
  return `${day(start)} – ${day(end)}`;
}

const usable = (line: FirstLine) => !line.error && line.amountCents !== null;
/** Basis points rounded to a whole percent. */
const wholePercent = (bp: number) => Math.round(bp / 100) * 100;

export type FoundRate = { rateBp: number; lines: number; of: number; from: "rate column" | "paid ÷ premium" | "assumed" };

/** The agency's rate: the Rate column's commonest value, else paid ÷ premium on commission lines, else 100%. */
export function inferRate(lines: readonly FirstLine[]): FoundRate {
  const rated = lines.filter((line) => usable(line) && line.kind !== "chargeback" && line.rateBp !== null).map((line) => line.rateBp as number);
  const fromColumn = mostCommon(rated);
  if (fromColumn) return { rateBp: fromColumn.value, lines: fromColumn.count, of: rated.length, from: "rate column" };
  const worked = lines
    .filter((line) => usable(line) && line.kind === "commission" && (line.amountCents ?? 0) > 0 && (line.premiumCents ?? 0) > 0)
    .map((line) => wholePercent(((line.amountCents as number) * 10_000) / (line.premiumCents as number)));
  const fromPremium = mostCommon(worked);
  if (fromPremium) return { rateBp: fromPremium.value, lines: fromPremium.count, of: worked.length, from: "paid ÷ premium" };
  return { rateBp: 10_000, lines: 0, of: 0, from: "assumed" };
}

export type FoundAdvance = { pctBp: number; months: number; lines: number; of: number };

/** The share of year one an advance line paid, in whole percent: paid ÷ (annual premium × rate). Null when it cannot be read. */
function advanceShareBp(line: FirstLine, rateBp: number): number | null {
  if (line.kind !== "advance" || !usable(line) || (line.amountCents ?? 0) <= 0 || !line.premiumCents) return null;
  const rate = line.rateBp ?? rateBp;
  if (rate <= 0) return null;
  const yearOne = (line.premiumCents * rate) / 10_000;
  return wholePercent(((line.amountCents as number) * 10_000) / yearOne);
}

/** Months of commission an advance of `pctBp` of year one is: 75% is 9 months. At least 1, at most 12. */
export function advanceMonthsOf(pctBp: number): number {
  return Math.min(12, Math.max(1, Math.round((pctBp * 12) / 10_000)));
}

/** The advance the carrier pays, from every advance line it can be read off; null when the statement has none. */
export function inferAdvance(lines: readonly FirstLine[], rateBp: number): FoundAdvance | null {
  const shares = lines.map((line) => advanceShareBp(line, rateBp)).filter((bp): bp is number => bp !== null && bp > 0 && bp <= 100_000);
  const common = mostCommon(shares);
  if (!common) return null;
  return { pctBp: common.value, months: advanceMonthsOf(common.value), lines: common.count, of: shares.length };
}

export type WrongLine = { lineNumber: number; policyNumber: string | null; insuredName: string | null; what: "rate" | "advance"; paidBp: number; expectedBp: number };

/** Lines paid at another rate than the agency's, or advanced at another share than the rest. */
export function wrongLines(lines: readonly FirstLine[], rateBp: number, advance: FoundAdvance | null): WrongLine[] {
  const out: WrongLine[] = [];
  for (const line of lines) {
    if (!usable(line) || line.kind === "chargeback") continue;
    if (line.rateBp !== null && line.rateBp !== rateBp) {
      out.push({ lineNumber: line.lineNumber, policyNumber: line.policyNumber, insuredName: line.insuredName, what: "rate", paidBp: line.rateBp, expectedBp: rateBp });
      continue;
    }
    const share = advance ? advanceShareBp(line, rateBp) : null;
    if (advance && share !== null && share !== advance.pctBp) {
      out.push({ lineNumber: line.lineNumber, policyNumber: line.policyNumber, insuredName: line.insuredName, what: "advance", paidBp: share, expectedBp: advance.pctBp });
    }
  }
  return out;
}

export type NewPolicy = {
  policyNumber: string;
  insuredName: string;
  /** Annual premium, whole cents. */
  annualPremiumCents: number;
  premiumFrom: "statement" | "worked out" | "none";
  /** The first line date for the policy (else the period's start): its issue date in the book. */
  effectiveDate: string;
  lines: number;
  product: string | null;
  /** The day it lapsed, when every line for it is a chargeback (the advance it takes back was paid before this statement). */
  lapsedOn: string | null;
};

/** The annual premium a line implies when the statement prints none: paid ÷ rate (÷ the advance share on an advance). */
function premiumFromLine(line: FirstLine, rateBp: number, advance: FoundAdvance | null): number | null {
  if (!usable(line) || (line.amountCents ?? 0) <= 0) return null;
  const rate = line.rateBp ?? rateBp;
  if (rate <= 0) return null;
  if (line.kind === "commission") return Math.round(((line.amountCents as number) * 10_000) / rate);
  if (line.kind === "advance" && advance && advance.pctBp > 0) return Math.round(((line.amountCents as number) * 10_000 * 10_000) / (rate * advance.pctBp));
  return null;
}

/** Every policy on the statement the book does not hold yet, in the order the statement lists them. */
export function newPoliciesFrom(lines: readonly FirstLine[], book: readonly string[], input: { rateBp: number; advance: FoundAdvance | null; fallbackDate: string }): NewPolicy[] {
  const held = new Set(book.map(policyKey));
  const groups = new Map<string, FirstLine[]>();
  for (const line of lines) {
    if (line.error || !line.policyNumber) continue;
    const key = policyKey(line.policyNumber);
    if (!key || held.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return [...groups.values()].map((group) => {
    const printed = Math.max(0, ...group.map((line) => line.premiumCents ?? 0));
    const worked = printed > 0 ? 0 : Math.max(0, ...group.map((line) => premiumFromLine(line, input.rateBp, input.advance) ?? 0));
    const dates = group.map((line) => line.lineDate).filter((date): date is string => Boolean(date)).sort();
    return {
      policyNumber: (group[0].policyNumber as string).trim(),
      insuredName: group.find((line) => line.insuredName)?.insuredName?.trim() || "Not named on the statement",
      annualPremiumCents: printed > 0 ? printed : worked,
      premiumFrom: printed > 0 ? "statement" : worked > 0 ? "worked out" : "none",
      effectiveDate: dates[0] ?? input.fallbackDate,
      lines: group.length,
      product: mostCommon(group.map((line) => line.product?.trim() ?? "").filter(Boolean))?.value ?? null,
      lapsedOn: group.every((line) => line.kind === "chargeback") ? dates[dates.length - 1] ?? input.fallbackDate : null,
    };
  });
}

/** The product family the statement names most (a Product or Plan column), matched by code or name; null when none. */
export function guessProduct(lines: readonly FirstLine[], products: readonly FirstProduct[]): string | null {
  const hits: string[] = [];
  for (const line of lines) {
    const hit = matchProduct(line.product, products);
    if (hit) hits.push(hit);
  }
  return mostCommon(hits)?.value ?? null;
}

/** The product family one Product or Plan cell names, by code or name; null when it names none. */
export function matchProduct(cellText: string | null | undefined, products: readonly FirstProduct[]): string | null {
  const cell = alnum(cellText ?? "");
  if (!cell) return null;
  const hit = products.find((product) => alnum(product.code) === cell || alnum(product.name) === cell)
    ?? products.find((product) => alnum(product.name).length >= 4 && cell.includes(alnum(product.name)));
  return hit?.code ?? null;
}

/** Every product family the statement names, most lines first. */
export function productsNamed(lines: readonly FirstLine[], products: readonly FirstProduct[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const hit = matchProduct(line.product, products);
    if (hit) counts.set(hit, (counts.get(hit) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
}

export type FirstStatementFindings = {
  carrier: CarrierGuess;
  period: FoundPeriod;
  rate: FoundRate;
  advance: FoundAdvance | null;
  wrong: WrongLine[];
  policies: NewPolicy[];
  productCode: string | null;
  lines: number;
  unreadable: number;
  /** Net of every readable line, whole cents. */
  netCents: number;
};

/** Everything step 2 shows, from the parsed lines and what the agency already holds. */
export function readFirstStatement(input: {
  fileName: string;
  headers: readonly string[];
  lines: readonly FirstLine[];
  carriers: readonly FirstCarrier[];
  products: readonly FirstProduct[];
  carrierColumn?: readonly string[];
  layouts?: ReadonlyArray<{ carrierId: string; headers: readonly string[] }>;
  book: readonly string[];
  today: string;
}): FirstStatementFindings {
  const period = statementPeriodOf(input.lines, input.today);
  const rate = inferRate(input.lines);
  const advance = inferAdvance(input.lines, rate.rateBp);
  return {
    carrier: guessCarrier({ fileName: input.fileName, carriers: input.carriers, carrierColumn: input.carrierColumn, layouts: input.layouts, headers: input.headers }),
    period,
    rate,
    advance,
    wrong: wrongLines(input.lines, rate.rateBp, advance),
    policies: newPoliciesFrom(input.lines, input.book, { rateBp: rate.rateBp, advance, fallbackDate: period.start }),
    productCode: guessProduct(input.lines, input.products),
    lines: input.lines.length,
    unreadable: input.lines.filter((line) => line.error).length,
    netCents: input.lines.reduce((sum, line) => sum + (line.error ? 0 : line.amountCents ?? 0), 0),
  };
}

/** The headers of a file's Carrier and Product columns, when it has them. */
export function extraColumns(headers: readonly string[]): { carrier: string | null; product: string | null } {
  const key = (header: string) => header.toLowerCase().replace(/[_.]+/g, " ").trim();
  return {
    carrier: headers.find((header) => /^(carrier|company|insurer)( name)?$/.test(key(header))) ?? null,
    product: headers.find((header) => /^(product|plan)( name| code| type)?$/.test(key(header))) ?? null,
  };
}

/** "75%" / "82.5%" from basis points. */
export function percentLabel(bp: number): string {
  const value = bp / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, "")}%`;
}

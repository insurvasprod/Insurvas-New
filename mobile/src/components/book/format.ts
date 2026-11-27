import type { Tone } from "@/theme/tokens";

import type { WebTone } from "./types";

/**
 * The Book's words and figures, as the web writes them (lib/ingestion/policyMoney.ts `cents`, overview-tab.tsx):
 * premiums and commission lines keep their cents ("$41.20", "−$92.70"); a face amount drops ".00" ("$10,000").
 * Pure, so the tests read the same rules the screens use.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** "$1,284.00", with a minus sign (−) for money going out; "—" when unknown. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A face amount: whole dollars when it is whole ("$10,000"), as the web's strip writes it. */
export function faceMoney(cents: number | null | undefined): string {
  return money(cents).replace(/\.00$/, "");
}

/** The parts the board's money figure draws apart: a small "$", the whole, and small cents (none when whole and `dropZero`). */
export function moneyParts(cents: number, dropZero = false): { sign: string; whole: string; cents: string | null } {
  const text = money(Math.abs(cents)).slice(1);
  const [whole, part] = text.split(".");
  return { sign: cents < 0 ? "−" : "", whole, cents: dropZero && part === "00" ? null : part ?? null };
}

const MODE: Record<string, string> = { monthly: "/mo", quarterly: "/qtr", semiannual: "/6 mo", annual: "/yr" };

/** "$41.20/mo": a premium with its mode, as the web's Premium figure. */
export function premiumText(cents: number | null, mode: string | null): string | null {
  if (cents === null) return null;
  return `${money(cents)}${mode ? MODE[mode] ?? ` ${mode}` : ""}`;
}

/** "2 Mar 2026". */
export function dayMonthYear(iso: string | null | undefined): string {
  const m = iso ? DAY.exec(iso) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "—";
}

/** "3 Dec". */
export function dayMonth(iso: string | null | undefined): string {
  const m = iso ? DAY.exec(iso) : null;
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : "—";
}

/** "Mar". */
export function monthOf(iso: string | null | undefined): string | null {
  const m = iso ? DAY.exec(iso) : null;
  return m ? MONTHS[Number(m[2]) - 1] : null;
}

/** "07/02/1961": how a carrier's row writes a birth date. */
export function slashDate(iso: string | null | undefined): string | null {
  const m = iso ? DAY.exec(iso) : null;
  return m ? `${m[2]}/${m[3]}/${m[1]}` : null;
}

/** "3rd of the month". */
export function draftDayText(day: number | null): string | null {
  if (!day) return null;
  const tail = day % 100 >= 11 && day % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
  return `${day}${tail} of the month`;
}

/** The web's chip tones in the app's colours. */
export function toneOf(tone: WebTone | string): Tone {
  switch (tone) {
    case "good": return "ok";
    case "info": return "info";
    case "warning": return "warn";
    case "danger": return "bad";
    default: return "neutral";
  }
}

/** The ledger line's title: "Advance · 9 months" when the statement said how many months it advanced. */
export function lineTitle(line: { label: string; type: string; monthsAdvanced: number | null }): string {
  return line.type === "advance" && line.monthsAdvanced ? `${line.label} · ${line.monthsAdvanced} months` : line.label;
}

/** The first word of a name, for "Call Maria" and "Link to George". */
export function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

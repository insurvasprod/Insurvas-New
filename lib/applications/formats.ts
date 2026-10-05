// Client-safe checks for the values an application holds (LA-3.7, 3.11, 3.19). Pure functions:
// the QA engine, the payment form and the API's Zod refinements all call these, so the three can
// never disagree about what a valid card or SSN is.

import { digitsOnly, isValidAbaRouting, isValidBankAccount } from "../templates/formats.ts";

export { digitsOnly, isValidAbaRouting, isValidBankAccount };

/**
 * A Social Security number that is not an obviously invalid pattern: nine digits, area not 000,
 * 666 or 900–999, group not 00, serial not 0000. "666-12-3456" fails; "123-45-6789" passes.
 */
export function isPlausibleSsn(value: string) {
  const digits = digitsOnly(value);
  if (digits.length !== 9 || digits.length !== value.replace(/[\s-]/g, "").length) return false;
  const area = Number(digits.slice(0, 3));
  const group = digits.slice(3, 5);
  const serial = digits.slice(5);
  if (area === 0 || area === 666 || area >= 900) return false;
  return group !== "00" && serial !== "0000";
}

/** The Luhn checksum every payment card number carries. */
export function passesLuhn(value: string) {
  const digits = digitsOnly(value);
  if (digits.length < 12 || digits.length > 19 || digits.length !== value.replace(/[\s-]/g, "").length) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export type CardBrand = "visa" | "mastercard" | "discover" | "amex";

/** The brand a card number's leading digits imply, or null when they match none we accept. */
export function cardBrand(value: string): CardBrand | null {
  const d = digitsOnly(value);
  if (/^4/.test(d)) return "visa";
  if (/^3[47]/.test(d)) return "amex";
  const two = Number(d.slice(0, 2));
  const four = Number(d.slice(0, 4));
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return "mastercard";
  const three = Number(d.slice(0, 3));
  if (/^6011/.test(d) || /^65/.test(d) || (three >= 644 && three <= 649)) return "discover";
  return null;
}

/** Card expiry is this month or later. Month 1–12, four-digit year. */
export function cardExpiryInFuture(month: number, year: number, today = new Date()) {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) return false;
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  return year > y || (year === y && month >= m);
}

/** Last four digits for a masked display: "••••1234". Four or fewer digits show only the dots. */
export function maskLast4(value: string | null | undefined) {
  const digits = digitsOnly(value ?? "");
  return digits.length > 4 ? `••••${digits.slice(-4)}` : "••••";
}

/** "••••1234" from a STORED last four (1–4 digits). Nothing stored reads "••••". */
export function maskFromLast4(last4: string | null | undefined) {
  const digits = digitsOnly(last4 ?? "").slice(-4);
  return digits ? `••••${digits}` : "••••";
}

/** DOB display variants copy-assist offers (LA-3.14). Input is YYYY-MM-DD. */
export function dobVariants(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return [iso];
  const [, y, mo, d] = m;
  return [`${mo}/${d}/${y}`, `${y}${mo}${d}`, `${mo}-${d}-${y}`];
}

/** Phone display variants copy-assist offers (LA-3.14). */
export function phoneVariants(raw: string) {
  const d = digitsOnly(raw).replace(/^1(?=\d{10}$)/, "");
  if (d.length !== 10) return [raw];
  return [`(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, d, `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`];
}

/** Stored prose with Unix line endings and no stray edges: the Supabase SQL editor saves pasted text as CRLF. */
export function normaliseProse(s: string | null | undefined): string {
  return (s ?? "").replace(/\r\n?/g, "\n").trim();
}

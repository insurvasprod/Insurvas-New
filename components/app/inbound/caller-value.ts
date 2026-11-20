/**
 * One detail the partner sent, as the caller profile (Inbound step 2) shows it. Pure: tested in
 * caller-value.test.mjs.
 *
 * Money: a `currency` field is stored in cents, the way the partner portal saves it (it types dollars
 * and stores `dollars × 100`, partner-portal-workspace.tsx) and every agent screen reads it
 * (verification-panel.tsx, lead-workspace.tsx, lead-detail-workspace.tsx). Read as dollars, a $250,000
 * hot lead showed $25,000,000 here (Basic walk 2026-11-20). A plain `number` field whose name says
 * money (an amount typed by a person) is whole dollars, as before.
 */

export type CallerField = { field_key: string; label: string; type?: string | null };

const MONEY = /amount|premium|coverage|income|salary|benefit/i;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

function usd(dollars: number) {
  const cents = Number.isInteger(dollars) ? 0 : 2;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents, maximumFractionDigits: cents });
}

export function callerValue(field: CallerField, value: string): string {
  if (ISO_DAY.test(value)) {
    const day = new Date(value);
    if (!Number.isNaN(day.getTime())) return day.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  if (!NUMERIC.test(value)) return value;
  if (field.type === "currency") return usd(Number(value) / 100);
  if (MONEY.test(`${field.field_key} ${field.label}`)) return usd(Number(value));
  return value;
}

import type { CeRecordRow, EoPolicyRow, LicenseRow } from "./service-types";

/**
 * The warning window and its severity bands.
 *
 * These used to be the only three days a warning could fire: `expiryWarningFor` asked whether the
 * days left were exactly 90, 60 or 30, so a licence 73 days out was silent on the settings page, and
 * one day of a missed cron run skipped a whole band of email. They are now bands: a record anywhere
 * inside the 90-day window warns every day, and `days` says which band it is in (the tightest
 * threshold it has crossed). `daysLeft` carries the real count for display.
 *
 * The email script dedupes on the band, so it still sends one message per band per record rather
 * than one a day.
 */
export const EXPIRY_WARNING_DAYS = [90, 60, 30] as const;
export type ExpiryWarningDays = (typeof EXPIRY_WARNING_DAYS)[number];
export type ExpiryWarningSource = "license" | "eo_policy" | "ce_record";
export type ExpiryWarning = {
  source: ExpiryWarningSource;
  sourceId: string;
  label: string;
  expiresAt: string;
  /** The severity band: 90, 60 or 30. */
  days: ExpiryWarningDays;
  /** Whole days until expiry, 0 meaning today. */
  daysLeft: number;
  state?: string;
};

const DAY = 86_400_000;
function utcDay(value: string | Date) {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  const [year, month, day] = text.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function daysUntilExpiry(expiresAt: string, asOf: string | Date): number {
  return Math.round((utcDay(expiresAt) - utcDay(asOf)) / DAY);
}

/** The band a record sits in, or null outside the window (more than 90 days out, or already past). */
export function expiryWarningFor(expiresAt: string, asOf: string | Date): ExpiryWarningDays | null {
  const days = daysUntilExpiry(expiresAt, asOf);
  if (!Number.isFinite(days) || days < 0) return null;
  let band: ExpiryWarningDays | null = null;
  for (const threshold of EXPIRY_WARNING_DAYS) if (days <= threshold) band = threshold;
  return band;
}

export function dueExpiryWarnings(rows: { licenses: LicenseRow[]; eoPolicies: EoPolicyRow[]; ceRecords: CeRecordRow[] }, asOf: string | Date): ExpiryWarning[] {
  const warnings: ExpiryWarning[] = [];
  const push = (base: Omit<ExpiryWarning, "days" | "daysLeft">) => {
    const days = expiryWarningFor(base.expiresAt, asOf);
    if (days) warnings.push({ ...base, days, daysLeft: daysUntilExpiry(base.expiresAt, asOf) });
  };
  for (const row of rows.licenses) push({ source: "license", sourceId: row.id, label: `${row.state} licence`, state: row.state, expiresAt: row.expires_at });
  for (const row of rows.eoPolicies) push({ source: "eo_policy", sourceId: row.id, label: `E&O policy ${row.policy_number}`, expiresAt: row.expires_at });
  for (const row of rows.ceRecords) push({ source: "ce_record", sourceId: row.id, label: `${row.state} continuing education`, state: row.state, expiresAt: row.deadline });
  return warnings.sort((a, b) => a.daysLeft - b.daysLeft || a.label.localeCompare(b.label));
}

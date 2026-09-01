import type { CeRecordRow, EoPolicyRow, LicenseRow } from "./service-types";

export const EXPIRY_WARNING_DAYS = [90, 60, 30] as const;
export type ExpiryWarningDays = (typeof EXPIRY_WARNING_DAYS)[number];
export type ExpiryWarningSource = "license" | "eo_policy" | "ce_record";
export type ExpiryWarning = { source: ExpiryWarningSource; sourceId: string; label: string; expiresAt: string; days: ExpiryWarningDays; state?: string };

const DAY = 86_400_000;
function utcDay(value: string | Date) {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  const [year, month, day] = text.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function daysUntilExpiry(expiresAt: string, asOf: string | Date): number {
  return Math.round((utcDay(expiresAt) - utcDay(asOf)) / DAY);
}

export function expiryWarningFor(expiresAt: string, asOf: string | Date): ExpiryWarningDays | null {
  const days = daysUntilExpiry(expiresAt, asOf);
  return (EXPIRY_WARNING_DAYS as readonly number[]).includes(days) ? days as ExpiryWarningDays : null;
}

export function dueExpiryWarnings(rows: { licenses: LicenseRow[]; eoPolicies: EoPolicyRow[]; ceRecords: CeRecordRow[] }, asOf: string | Date): ExpiryWarning[] {
  const warnings: ExpiryWarning[] = [];
  for (const row of rows.licenses) { const days = expiryWarningFor(row.expires_at, asOf); if (days) warnings.push({ source: "license", sourceId: row.id, label: `${row.state} licence`, state: row.state, expiresAt: row.expires_at, days }); }
  for (const row of rows.eoPolicies) { const days = expiryWarningFor(row.expires_at, asOf); if (days) warnings.push({ source: "eo_policy", sourceId: row.id, label: `E&O policy ${row.policy_number}`, expiresAt: row.expires_at, days }); }
  for (const row of rows.ceRecords) { const days = expiryWarningFor(row.deadline, asOf); if (days) warnings.push({ source: "ce_record", sourceId: row.id, label: `${row.state} continuing education`, state: row.state, expiresAt: row.deadline, days }); }
  return warnings.sort((a, b) => a.days - b.days || a.label.localeCompare(b.label));
}

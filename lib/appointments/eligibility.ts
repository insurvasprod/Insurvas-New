import type { AppointmentRow, EoPolicyRow, LicenseRow } from "./service-types";

export type EligibilityVault = {
  tenantCarriers: Array<{ carrier_id: string; effective_from: string }>;
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  eoPolicies: EoPolicyRow[];
};

type AppointmentDates = Pick<AppointmentRow, "status" | "effective_from" | "terminated_at"> & { expires_at?: string | null };

/**
 * Whether an appointment is active for a market on the requested date.
 *
 * 'pending' never counts, and neither does an appointment past its expires_at (migration
 * 20260924310000): an expired appointment stops counting exactly as a terminated one does.
 */
export function appointmentIsActiveAt(row: AppointmentDates, asOf: string): boolean {
  return (
    row.status === "active" &&
    row.effective_from <= asOf &&
    (!row.terminated_at || row.terminated_at > asOf) &&
    (!row.expires_at || row.expires_at >= asOf)
  );
}

/**
 * The appointment half of assignment_candidate_is_eligible, row by row, for the code paths that
 * must answer before (or without) the database function: status 'active', started, not ended and
 * not expired. Ended is inclusive here (terminated_at >= today) because the SQL gate is; keep the
 * two identical rather than "fixing" one of them.
 */
export function appointmentCountsForRouting(
  row: { status: string; effective_from: string | null; terminated_at: string | null; expires_at?: string | null },
  today: string,
): boolean {
  const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : null);
  const effective = day(row.effective_from);
  const terminated = day(row.terminated_at);
  const expires = day(row.expires_at);
  return (
    row.status === "active" &&
    (!effective || effective <= today) &&
    (!terminated || terminated >= today) &&
    (!expires || expires >= today)
  );
}

/**
 * Sixteen Open Questions #4 (E&O lapses by two days): for a configurable number of days after the
 * E&O policy expires — default 7, capped by the platform so a tenant can shorten it but never extend
 * it — canWrite is still true, with the reason `grace`. After that it is false (`eo_expired`), and
 * only new business is blocked: servicing and reporting never call canWrite.
 *
 * The SQL twin is can_write / can_write_reason (migration 20261015580000), which reads the platform
 * setting compliance.eo_grace_days with the same default and bounds.
 */
export const DEFAULT_EO_GRACE_DAYS = 7;
export const MAX_EO_GRACE_DAYS = 14;

export type CanWriteReason = "ok" | "grace" | "no_contract" | "no_appointment" | "no_licence" | "eo_expired" | "no_eo";

export type CanWriteResult = {
  allowed: boolean;
  reason: CanWriteReason;
  /** In grace: the last day new business can still be written. Otherwise null. */
  graceEndsOn: string | null;
};

export type GraceOptions = {
  /** The platform's grace (the cap). Defaults to DEFAULT_EO_GRACE_DAYS. */
  graceDays?: number | null;
  /** A tenant's own, shorter grace. Never extends the platform's. */
  tenantGraceDays?: number | null;
};

function wholeDays(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

/** The grace in force: the platform's (0..14, default 7), shortened — never lengthened — by the tenant's. */
export function effectiveEoGraceDays(options: GraceOptions = {}): number {
  const platform = Math.min(wholeDays(options.graceDays, DEFAULT_EO_GRACE_DAYS), MAX_EO_GRACE_DAYS);
  return Math.min(platform, wholeDays(options.tenantGraceDays, platform));
}

/** `date` (YYYY-MM-DD) plus whole days, as YYYY-MM-DD. Calendar arithmetic in UTC, so no DST drift. */
export function addDays(date: string, days: number): string {
  const at = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10);
}

export type EoCoverState = { state: "in_force" | "grace" | "expired" | "none"; expiredOn: string | null; graceEndsOn: string | null };

/** Where the agency's E&O cover stands on `asOf`, from the policy that runs longest. */
export function eoCoverState(policies: ReadonlyArray<{ expires_at: string }>, asOf: string, options: GraceOptions = {}): EoCoverState {
  if (policies.length === 0) return { state: "none", expiredOn: null, graceEndsOn: null };
  const latest = policies.reduce((best, row) => (row.expires_at > best ? row.expires_at : best), policies[0].expires_at).slice(0, 10);
  if (latest >= asOf) return { state: "in_force", expiredOn: null, graceEndsOn: null };
  const graceEndsOn = addDays(latest, effectiveEoGraceDays(options));
  return graceEndsOn >= asOf ? { state: "grace", expiredOn: latest, graceEndsOn } : { state: "expired", expiredOn: latest, graceEndsOn };
}

/** canWrite with its reason, so callers can tell "no appointment" from "in grace" from "E&O expired". */
export function canWriteReasonFromVault(vault: EligibilityVault, carrierId: string, state: string, asOf: string, options: GraceOptions = {}): CanWriteResult {
  const normalizedState = state.trim().toUpperCase();
  const hasContract = vault.tenantCarriers.some((row) => row.carrier_id === carrierId && row.effective_from <= asOf);
  if (!hasContract) return { allowed: false, reason: "no_contract", graceEndsOn: null };
  if (!hasAppointmentAt(vault, carrierId, normalizedState, asOf)) return { allowed: false, reason: "no_appointment", graceEndsOn: null };
  if (!vault.licenses.some((row) => row.state === normalizedState && row.expires_at >= asOf)) return { allowed: false, reason: "no_licence", graceEndsOn: null };
  const eo = eoCoverState(vault.eoPolicies, asOf, options);
  if (eo.state === "in_force") return { allowed: true, reason: "ok", graceEndsOn: null };
  if (eo.state === "grace") return { allowed: true, reason: "grace", graceEndsOn: eo.graceEndsOn };
  return { allowed: false, reason: eo.state === "none" ? "no_eo" : "eo_expired", graceEndsOn: null };
}

function hasAppointmentAt(vault: EligibilityVault, carrierId: string, normalizedState: string, asOf: string): boolean {
  return vault.appointments.some((row) => {
    if (row.carrier_id !== carrierId || row.state !== normalizedState || row.effective_from > asOf) return false;
    // A pending appointment has not been granted; an expired one no longer is.
    if (row.expires_at && row.expires_at < asOf) return false;
    if (row.status === "active") return !row.terminated_at || row.terminated_at > asOf;
    // A policy written before a termination stays writable at its own date (Notion, LA-0.5).
    return row.status === "terminated" && row.terminated_at !== null && row.terminated_at > asOf;
  });
}

/** One eligibility rule for every caller: appointment, carrier contract, licence and E&O (with its grace). */
export function canWriteFromVault(vault: EligibilityVault, carrierId: string, state: string, asOf: string, options: GraceOptions = {}): boolean {
  return canWriteReasonFromVault(vault, carrierId, state, asOf, options).allowed;
}

// Settings › Carriers (owner pick D, 2026-10-26): the rules behind its three steps, client-safe.
// Your carriers (LA-0.4 contract), States (LA-0.5 / LA-3.6 appointments: carrier × state), State
// licences (LA-0.5). The screen ticks a carrier in a state; this file turns a tick into the rows the
// appointment vault saves, without ever deleting one (a terminated appointment keeps its dates).

import type { AppointmentRow, AppointmentStatus, LicenseRow } from "./service-types.ts";

export type AppointmentChange = {
  id?: string;
  carrier_id: string;
  state: string;
  status: AppointmentStatus;
  effective_from: string;
  terminated_at?: string | null;
};

/** Today as YYYY-MM-DD in the viewer's zone: the day a tick takes effect. */
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Not ended: not terminated, not past a termination date, not expired. Pending counts (applied for). */
export function isOpenAppointment(row: Pick<AppointmentRow, "status" | "terminated_at" | "expires_at">, today: string) {
  if (row.status === "terminated") return false;
  if (row.terminated_at && row.terminated_at <= today) return false;
  if (row.expires_at && row.expires_at < today) return false;
  return true;
}

/** The carrier's open appointment in a state, newest first; null when it holds none. */
export function currentAppointment(rows: AppointmentRow[], carrierId: string, state: string, today: string) {
  return rows
    .filter((row) => row.carrier_id === carrierId && row.state === state && isOpenAppointment(row, today))
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

/**
 * What to save so the carrier is (on) or is not (off) appointed in the state from today. Nothing when
 * it already is what was asked. Off ends the open row today; on reopens a row that started today
 * (the vault is unique on carrier + state + start date) or starts a new one.
 */
export function appointmentChange(rows: AppointmentRow[], carrierId: string, state: string, on: boolean, today: string): AppointmentChange[] {
  const open = currentAppointment(rows, carrierId, state, today);
  if (on) {
    if (open) return [];
    const sameDay = rows.find((row) => row.carrier_id === carrierId && row.state === state && row.effective_from === today);
    if (sameDay) return [{ id: sameDay.id, carrier_id: carrierId, state, status: "active", effective_from: today, terminated_at: null }];
    return [{ carrier_id: carrierId, state, status: "active", effective_from: today }];
  }
  if (!open) return [];
  const end = open.effective_from > today ? open.effective_from : today;
  return [{ id: open.id, carrier_id: carrierId, state, status: "terminated", effective_from: open.effective_from, terminated_at: end }];
}

/**
 * The rows as they will be once these changes save, for a screen that answers before the server does
 * (Contracting set-up). A change with an id updates that row; one without starts a new row with a
 * local id until the next read replaces it.
 */
export function applyAppointmentChanges(rows: AppointmentRow[], changes: AppointmentChange[], today: string): AppointmentRow[] {
  let next = [...rows];
  for (const change of changes) {
    if (change.id) {
      next = next.map((row) => (row.id === change.id ? { ...row, status: change.status, effective_from: change.effective_from, terminated_at: change.terminated_at ?? null } : row));
    } else {
      next.push({ id: `local-${change.carrier_id}-${change.state}-${next.length}`, tenant_id: "", carrier_id: change.carrier_id, state: change.state, status: change.status, effective_from: change.effective_from, terminated_at: null, created_at: today, updated_at: today, expires_at: null });
    }
  }
  return next;
}

/** For several selected states at once: is the carrier on in all, some or none of them? */
export function coverage(rows: AppointmentRow[], carrierId: string, states: string[], today: string): "all" | "some" | "none" {
  const on = states.filter((state) => currentAppointment(rows, carrierId, state, today)).length;
  return on === 0 ? "none" : on === states.length ? "all" : "some";
}

/** The carriers appointed in a state today. */
export function carriersIn(rows: AppointmentRow[], state: string, today: string) {
  return [...new Set(rows.filter((row) => row.state === state && isOpenAppointment(row, today)).map((row) => row.carrier_id))];
}

/**
 * Granted and in force: open and no longer pending. What "can sell here" means everywhere a carrier
 * is called ready (eligibility.ts agrees: a pending appointment never counts). A pending one is
 * still ticked on the States step, since it was applied for, but it does not make a carrier ready.
 */
export function isActiveAppointment(row: Pick<AppointmentRow, "status" | "terminated_at" | "expires_at">, today: string) {
  return row.status === "active" && isOpenAppointment(row, today);
}

/** The states a carrier can sell in today (active appointments only), A to Z. */
export function appointedStatesFor(rows: AppointmentRow[], carrierId: string, today: string) {
  return [...new Set(rows.filter((row) => row.carrier_id === carrierId && isActiveAppointment(row, today)).map((row) => row.state))].sort();
}

/** The states where the carrier's appointment is applied for but not granted yet, A to Z. */
export function pendingStatesFor(rows: AppointmentRow[], carrierId: string, today: string) {
  const appointed = new Set(appointedStatesFor(rows, carrierId, today));
  return [...new Set(rows.filter((row) => row.carrier_id === carrierId && row.status === "pending" && isOpenAppointment(row, today) && !appointed.has(row.state)).map((row) => row.state))].sort();
}

/** The states a carrier is ticked in today, pending included, A to Z (the States step's count). */
export function statesFor(rows: AppointmentRow[], carrierId: string, today: string) {
  return [...new Set(rows.filter((row) => row.carrier_id === carrierId && isOpenAppointment(row, today)).map((row) => row.state))].sort();
}

/**
 * A licence the agent ticked without its details (owner, 2026-10-28: "it will work even without
 * those"). The table needs a number and an expiry, and every check (dialer, routing, eligibility,
 * expiry warnings) reads a licence by its expiry, so a tick is stored with these two placeholders:
 * a licence that is valid and never due. Screens show them as "No number yet" and "No expiry".
 */
export const LICENCE_NUMBER_NOT_ENTERED = "Not entered";
export const LICENCE_NO_EXPIRY = "9999-12-31";

/** The licence number to show: blank for a placeholder. */
export function licenceNumberValue(number: string | null | undefined): string {
  return !number || number === LICENCE_NUMBER_NOT_ENTERED ? "" : number;
}

/** The expiry to show in a date field: blank for a placeholder. */
export function licenceExpiryValue(expiresAt: string | null | undefined): string {
  return !expiresAt || expiresAt === LICENCE_NO_EXPIRY ? "" : expiresAt;
}

/** A licence's state: on file and valid, due for renewal inside 60 days, or expired. */
export function licenceStatus(row: Pick<LicenseRow, "expires_at"> | null | undefined, today: string): { label: string; tone: "good" | "warning" | "danger" } | null {
  if (!row) return null;
  const days = Math.round((Date.parse(`${row.expires_at}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return { label: "Expired", tone: "danger" };
  if (days <= 60) return { label: days === 0 ? "Renew today" : `Renew in ${days} day${days === 1 ? "" : "s"}`, tone: "warning" };
  return { label: "Active", tone: "good" };
}

/** "110" or "110.5" (percent, as carriers quote it) → basis points; anything else → null. */
export function levelToBp(value: string): number | null {
  const trimmed = value.trim().replace(/%$/, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(trimmed)) return null;
  const bp = Math.round(Number(trimmed) * 100);
  return bp >= 0 && bp <= 100000 ? bp : null;
}

/** 11000 → "110", 10550 → "105.5". */
export function bpToLevel(bp: number | null | undefined) {
  if (bp === null || bp === undefined) return "";
  return String(Number((bp / 100).toFixed(2)));
}

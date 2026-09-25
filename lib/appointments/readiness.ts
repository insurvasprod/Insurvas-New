/**
 * /app/appointments: "whether you may legally write this product in this state today".
 *
 * Pure, so the page and its tests read the same answers. The page's window is 60 days (the owner's
 * decision for this screen); lib/appointments/warnings.ts keeps its own 90/60/30 bands for the
 * expiry email and the Settings rail, and nothing here changes them.
 *
 * The routing half comes from appointmentCountsForRouting, the row-level copy of
 * assignment_candidate_is_eligible, so "no longer counts toward routing" on this page is the same
 * statement the router makes.
 */
import { US_STATES, compareByRegion } from "./constants.ts";
import { appointmentCountsForRouting } from "./eligibility.ts";
import { daysUntilExpiry } from "./warnings.ts";
import type { AppointmentRow, CarrierTrainingRow, CeRecordRow, EoPolicyRow, LicenseRow } from "./service-types";

export const READINESS_WINDOW_DAYS = 60;

const STATE_NAME = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
export const stateName = (code: string) => STATE_NAME.get(code) ?? code;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "4 Sep 2026", or "4 Sep" when `withYear` is false. Parsed by hand so no time zone can shift the day. */
export function dayMonth(value: string, withYear = true): string {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  return `${day} ${MONTHS[month - 1]}${withYear ? ` ${year}` : ""}`;
}
/** Drops the year when it is this year, the way the board writes a recent date. */
const recentDate = (value: string, today: string) => dayMonth(value, value.slice(0, 4) !== today.slice(0, 4));

export const cellKey = (carrierId: string, state: string) => `${carrierId}:${state}`;

type Datable = Pick<AppointmentRow, "carrier_id" | "state" | "effective_from"> & { created_at?: string };

/** The row that describes a carrier × state today: latest effective_from, then latest created_at. */
export function latestAppointmentByCell<T extends Datable>(rows: readonly T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = cellKey(row.carrier_id, row.state);
    const current = latest.get(key);
    if (
      !current ||
      row.effective_from > current.effective_from ||
      (row.effective_from === current.effective_from && (row.created_at ?? "") > (current.created_at ?? ""))
    ) {
      latest.set(key, row);
    }
  }
  return latest;
}

export type CellStatus =
  | { kind: "none" }
  | { kind: "appointed" }
  | { kind: "expiring"; daysLeft: number }
  | { kind: "pending" }
  | { kind: "starts"; on: string }
  | { kind: "expired"; on: string }
  | { kind: "ended" };

/** What one carrier × state cell says, read from its latest row. Appointed and expiring are the two that route. */
export function appointmentCellStatus(
  row: Pick<AppointmentRow, "status" | "effective_from" | "terminated_at" | "expires_at"> | undefined,
  today: string,
  windowDays = READINESS_WINDOW_DAYS,
): CellStatus {
  if (!row) return { kind: "none" };
  if (row.status === "terminated") return { kind: "ended" };
  if (row.status === "pending") return { kind: "pending" };
  if (row.terminated_at && row.terminated_at < today) return { kind: "ended" };
  if (row.expires_at && row.expires_at < today) return { kind: "expired", on: row.expires_at };
  if (row.effective_from > today) return { kind: "starts", on: row.effective_from };
  if (row.expires_at) {
    const daysLeft = daysUntilExpiry(row.expires_at, today);
    if (daysLeft <= windowDays) return { kind: "expiring", daysLeft };
  }
  return { kind: "appointed" };
}

/**
 * What the per-cell dialog opens with. An 'active' row whose end date has passed reads as Ended in
 * the table, so it opens as Ended; an empty cell opens as a new active appointment from today.
 */
export function cellDialogDefaults(
  row: Pick<AppointmentRow, "status" | "effective_from" | "terminated_at" | "expires_at"> | undefined,
  today: string,
): { status: AppointmentRow["status"]; effective_from: string; expires_at: string; terminated_at: string } {
  if (!row) return { status: "active", effective_from: today, expires_at: "", terminated_at: today };
  const ended = appointmentCellStatus(row, today).kind === "ended";
  return {
    status: ended ? "terminated" : row.status,
    effective_from: row.effective_from,
    expires_at: row.expires_at ?? "",
    terminated_at: row.terminated_at ?? today,
  };
}

/** Current / "N days" / Expired, on the page's 60-day window. */
export function licenceStatus(expiresAt: string, today: string, windowDays = READINESS_WINDOW_DAYS): { tone: "success" | "warning" | "error"; label: string } {
  const days = daysUntilExpiry(expiresAt, today);
  if (days < 0) return { tone: "error", label: "Expired" };
  if (days <= windowDays) return { tone: "warning", label: `${days} ${days === 1 ? "day" : "days"}` };
  return { tone: "success", label: "Current" };
}

/** Every state with any appointment row or licence, ordered by Census region. */
export function appointmentFootprint(appointments: readonly { state: string }[], licenses: readonly { state: string }[]): string[] {
  return [...new Set([...appointments, ...licenses].map((row) => row.state))].sort(compareByRegion);
}

/** The E&O policy the page describes: the in-force one that runs longest, else the latest lapsed one. */
export function currentEoPolicy<T extends Pick<EoPolicyRow, "expires_at">>(policies: readonly T[], today: string): T | null {
  const byExpiry = policies.slice().sort((a, b) => b.expires_at.localeCompare(a.expires_at));
  return byExpiry.find((row) => row.expires_at >= today) ?? byExpiry[0] ?? null;
}

/** The CE cycle the page describes: the next deadline still ahead, else the latest one recorded. */
export function currentCeRecord<T extends Pick<CeRecordRow, "deadline">>(records: readonly T[], today: string): T | null {
  return (
    records.filter((row) => row.deadline >= today).sort((a, b) => a.deadline.localeCompare(b.deadline))[0] ??
    records.slice().sort((a, b) => b.deadline.localeCompare(a.deadline))[0] ??
    null
  );
}

export const outstandingTrainings = <T extends Pick<CarrierTrainingRow, "completed_on">>(trainings: readonly T[]) =>
  trainings.filter((row) => !row.completed_on);

/** "$1M", "$250K", "$1.5M". */
export function compactMoney(cents: number): string {
  const dollars = cents / 100;
  const trim = (value: number) => (Math.round(value * 10) / 10).toString();
  if (dollars >= 1_000_000) return `$${trim(dollars / 1_000_000)}M`;
  if (dollars >= 1_000) return `$${trim(dollars / 1_000)}K`;
  return `$${trim(dollars)}`;
}

const listNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const expiresIn = (days: number, prefix = "Expires") =>
  days === 0 ? `${prefix} today` : `${prefix} in ${days} ${days === 1 ? "day" : "days"}`;

export type ReadinessItem = {
  key: string;
  /** error = a blocker: something that stops a sale in a state today. warning = expiring inside the window. */
  tone: "error" | "warning";
  title: string;
  body: string;
  /** Days until (positive) or since (negative) the date that matters; orders the list. */
  days: number;
  /**
   * How many blockers or warnings this one card stands for. States with the same problem share a
   * card — seventeen identical "not licensed" cards bury the grid under the one fact they repeat —
   * but the pill still counts each state. Absent means one.
   */
  count?: number;
};

export type ReadinessInput = {
  carriers: ReadonlyArray<{ id: string; name: string }>;
  tenantCarriers: ReadonlyArray<{ carrier_id: string; is_active: boolean }>;
  appointments: readonly AppointmentRow[];
  licenses: readonly LicenseRow[];
  eoPolicies: readonly EoPolicyRow[];
  ceRecords: readonly CeRecordRow[];
  carrierTrainings?: readonly CarrierTrainingRow[] | null;
  carrierRequirements?: ReadonlyArray<{ carrier_id: string; requires_eo: boolean }> | null;
};

/** The carrier × state cells that route a lead today, as the SQL gate decides it (any in-date active row, carrier switched on). */
export function routingCells(input: Pick<ReadinessInput, "tenantCarriers" | "appointments">, today: string): Set<string> {
  const activeCarriers = new Set(input.tenantCarriers.filter((row) => row.is_active).map((row) => row.carrier_id));
  return new Set(
    input.appointments
      .filter((row) => activeCarriers.has(row.carrier_id) && appointmentCountsForRouting(row, today))
      .map((row) => cellKey(row.carrier_id, row.state)),
  );
}

/**
 * Everything expired or expiring inside the window, blockers first.
 *
 * Blockers: an appointment that expired, a licence that expired or was never recorded in a state the
 * agency is appointed in, and no E&O in force. Warnings, soonest first: licences, appointments, the
 * E&O policy, carrier trainings and CE deadlines with credits still owed.
 */
export function readinessItems(input: ReadinessInput, today: string, windowDays = READINESS_WINDOW_DAYS): ReadinessItem[] {
  const carrierName = new Map(input.carriers.map((row) => [row.id, row.name]));
  const nameOf = (carrierId: string) => carrierName.get(carrierId) ?? "A carrier";
  const routes = routingCells(input, today);
  const appointedStates = new Set([...routes].map((key) => key.split(":")[1]));
  const inWindow = (days: number) => Number.isFinite(days) && days >= 0 && days <= windowDays;
  const items: ReadinessItem[] = [];

  for (const row of latestAppointmentByCell(input.appointments).values()) {
    const status = appointmentCellStatus(row, today, windowDays);
    const state = stateName(row.state);
    if (status.kind === "expired" && !routes.has(cellKey(row.carrier_id, row.state))) {
      const others = [...new Set(
        [...routes]
          .filter((key) => key.endsWith(`:${row.state}`) && !key.startsWith(`${row.carrier_id}:`))
          .map((key) => nameOf(key.split(":")[0])),
      )].sort();
      items.push({
        key: `appointment-expired-${row.id}`,
        tone: "error",
        title: "Expired — cannot sell",
        body:
          `${nameOf(row.carrier_id)} in ${state} expired ${recentDate(status.on, today)}. ` +
          (others.length ? `${state} leads still route through ${listNames(others)}.` : `It no longer counts toward routing ${state} leads.`),
        days: daysUntilExpiry(status.on, today),
      });
    } else if (status.kind === "expiring") {
      items.push({
        key: `appointment-expiring-${row.id}`,
        tone: "warning",
        title: expiresIn(status.daysLeft),
        body: `Appointment: ${nameOf(row.carrier_id)} in ${state}, ${dayMonth(row.expires_at ?? "")}.`,
        days: status.daysLeft,
      });
    }
  }

  const licenceByState = new Map(input.licenses.map((row) => [row.state, row]));
  for (const row of input.licenses) {
    const days = daysUntilExpiry(row.expires_at, today);
    const state = stateName(row.state);
    if (days < 0 && appointedStates.has(row.state)) {
      items.push({
        key: `licence-expired-${row.id}`,
        tone: "error",
        title: "Expired — cannot sell",
        body: `State licence: ${state} expired ${recentDate(row.expires_at, today)}. ${state} leads cannot be assigned until it is renewed.`,
        days,
      });
    } else if (inWindow(days)) {
      items.push({ key: `licence-expiring-${row.id}`, tone: "warning", title: expiresIn(days), body: `State licence: ${state}, ${dayMonth(row.expires_at)}.`, days });
    }
  }
  const unlicensed = [...appointedStates].sort(compareByRegion).filter((code) => !licenceByState.has(code));
  if (unlicensed.length === 1) {
    const state = stateName(unlicensed[0]);
    items.push({
      key: `licence-missing-${unlicensed[0]}`,
      tone: "error",
      title: "Not licensed — cannot sell",
      body: `Appointed in ${state}, but no state licence is on file. ${state} leads cannot be assigned.`,
      days: 0,
    });
  } else if (unlicensed.length > 1) {
    items.push({
      key: "licence-missing",
      tone: "error",
      title: `Not licensed in ${unlicensed.length} states — cannot sell`,
      body: `Appointed, but no state licence is on file: ${listNames(unlicensed.map(stateName))}. Leads in these states cannot be assigned.`,
      days: 0,
      count: unlicensed.length,
    });
  }

  const eo = currentEoPolicy(input.eoPolicies, today);
  const eoDays = eo ? daysUntilExpiry(eo.expires_at, today) : -Infinity;
  if (!eo || eoDays < 0) {
    const requiring = input.carrierRequirements
      ? new Set(input.carrierRequirements.filter((row) => row.requires_eo).map((row) => row.carrier_id))
      : null;
    const atRisk = requiring ? [...routes].filter((key) => requiring.has(key.split(":")[0])).length : 0;
    items.push({
      key: "eo-none",
      tone: "error",
      title: "No E&O in force",
      body:
        (eo ? `${eo.carrier} policy ${eo.policy_number} expired ${recentDate(eo.expires_at, today)}.` : "No errors & omissions policy is on file.") +
        (atRisk > 0 ? ` ${atRisk} carrier appointment${atRisk === 1 ? " requires" : "s require"} it.` : ""),
      days: eo ? eoDays : 0,
    });
  } else if (inWindow(eoDays)) {
    const limits =
      eo.per_claim_cents != null && eo.aggregate_cents != null
        ? `${compactMoney(eo.per_claim_cents)} / ${compactMoney(eo.aggregate_cents)}`
        : compactMoney(eo.coverage_amount_cents);
    items.push({ key: `eo-expiring-${eo.id}`, tone: "warning", title: expiresIn(eoDays, "E&O expires"), body: `${limits}, ${eo.carrier}, ${dayMonth(eo.expires_at)}.`, days: eoDays });
  }

  for (const row of outstandingTrainings(input.carrierTrainings ?? [])) {
    const days = daysUntilExpiry(row.due_on, today);
    if (days < 0) {
      items.push({ key: `training-${row.id}`, tone: "warning", title: "Training overdue", body: `${nameOf(row.carrier_id)}: ${row.title}, due ${dayMonth(row.due_on)}.`, days });
    } else if (inWindow(days)) {
      items.push({ key: `training-${row.id}`, tone: "warning", title: expiresIn(days, "Training due"), body: `${nameOf(row.carrier_id)}: ${row.title}, ${dayMonth(row.due_on)}.`, days });
    }
  }

  for (const row of input.ceRecords) {
    const days = daysUntilExpiry(row.deadline, today);
    if (row.credits_completed >= row.credits_required || !inWindow(days)) continue;
    items.push({
      key: `ce-${row.id}`,
      tone: "warning",
      title: days === 0 ? "CE deadline today" : `CE deadline in ${days} ${days === 1 ? "day" : "days"}`,
      body: `${stateName(row.state)}: ${row.credits_completed} of ${row.credits_required} credits, ${dayMonth(row.deadline)}.`,
      days,
    });
  }

  const rank = (item: ReadinessItem) => (item.tone === "error" ? 0 : 1);
  return items.sort((a, b) => rank(a) - rank(b) || a.days - b.days || a.body.localeCompare(b.body));
}

/** The Readiness card's pill: "N blockers", else "N expiring", else "Nothing due". */
export function readinessSummary(items: readonly ReadinessItem[]): { tone: "error" | "warning" | "success"; label: string; blockers: number } {
  const blockers = items.filter((item) => item.tone === "error").reduce((sum, item) => sum + (item.count ?? 1), 0);
  if (blockers) return { tone: "error", label: `${blockers} ${blockers === 1 ? "blocker" : "blockers"}`, blockers };
  const expiring = items.reduce((sum, item) => sum + (item.count ?? 1), 0);
  if (expiring) return { tone: "warning", label: `${expiring} expiring`, blockers: 0 };
  return { tone: "success", label: "Nothing due", blockers: 0 };
}

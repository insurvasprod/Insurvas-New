/**
 * Licences & appointments, round 7 (docs/la4/mockups-r7/compliance.html #s7, boards 7·A and 7·A2).
 *
 * Plain module (no "use client"), so a server page or a test can read it too.
 *
 * - `blockerRows`: the Readiness tile's list, one line each. It is readinessItems() — the same items the
 *   tile counts — with the grouped "not licensed in N states" item opened out to one row per state, so the
 *   Blockers tab's count is the rows it shows.
 * - `carrierLines`: the Appointments tab, one line a carrier instead of the 51-column grid.
 * - `licenceChip`: one chip a licence row; "No number" is a chip, never grey text beside "Current".
 */
import { compareByRegion } from "./constants.ts";
import { daysUntilExpiry } from "./warnings.ts";
import {
  appointmentCellStatus,
  latestAppointmentByCell,
  readinessItems,
  routingCells,
  stateName,
  type ReadinessInput,
} from "./readiness.ts";
import type { LicenseRow } from "./service-types";

export type ChipTone = "good" | "warning" | "danger" | "neutral";
export type Chip = { tone: ChipTone; label: string };

export type BlockerKind =
  | "licence-expired"
  | "licence-expiring"
  | "licence-missing"
  | "appointment-expired"
  | "appointment-expiring"
  | "training-overdue"
  | "training-due";

export type BlockerRow = {
  key: string;
  kind: BlockerKind;
  /** "Licence expired", "Appointed, not licensed"… */
  label: string;
  /** Two-letter code; null for a carrier training (it has no state). */
  state: string | null;
  /** Null on a licence item: a state licence stands for every carrier. */
  carrierId: string | null;
  carrierLabel: string | null;
  /** ISO date that matters (expired on, expires on, due on); null when there is none. */
  due: string | null;
  chip: Chip;
  /** The short verb in the Next step column. */
  next: "Renew" | "Add licence" | "Open";
  /** The long sentence, for the row's tooltip. */
  detail: string;
};

const daysLeft = (days: number): string => (days <= 0 ? "Due today" : `${days} ${days === 1 ? "day" : "days"} left`);

/** The readiness items as one row each (expired first, then soonest — readinessItems' own order). */
export function blockerRows(input: ReadinessInput, today: string): BlockerRow[] {
  const carrierName = new Map(input.carriers.map((row) => [row.id, row.name]));
  const nameOf = (id: string) => carrierName.get(id) ?? "Carrier";
  const appointmentById = new Map(input.appointments.map((row) => [row.id, row]));
  const licenceById = new Map(input.licenses.map((row) => [row.id, row]));
  const trainingById = new Map((input.carrierTrainings ?? []).map((row) => [row.id, row]));
  const routes = routingCells(input, today);
  const carriersIn = (state: string) => [...new Set([...routes].filter((key) => key.endsWith(`:${state}`)).map((key) => key.split(":")[0]))];
  const licensed = new Set(input.licenses.map((row) => row.state));
  const unlicensed = [...new Set([...routes].map((key) => key.split(":")[1]))].filter((code) => !licensed.has(code)).sort(compareByRegion);

  const rows: BlockerRow[] = [];
  for (const item of readinessItems(input, today)) {
    const id = (prefix: string) => item.key.slice(prefix.length);
    if (item.key.startsWith("appointment-expired-") || item.key.startsWith("appointment-expiring-")) {
      const expired = item.key.startsWith("appointment-expired-");
      const row = appointmentById.get(id(expired ? "appointment-expired-" : "appointment-expiring-"));
      if (!row) continue;
      rows.push({
        key: item.key,
        kind: expired ? "appointment-expired" : "appointment-expiring",
        label: expired ? "Appointment expired" : "Appointment expires",
        state: row.state,
        carrierId: row.carrier_id,
        carrierLabel: nameOf(row.carrier_id),
        due: row.expires_at ?? null,
        chip: expired ? { tone: "danger", label: "Expired" } : { tone: "warning", label: daysLeft(item.days) },
        next: "Open",
        detail: item.body,
      });
    } else if (item.key.startsWith("licence-expired-") || item.key.startsWith("licence-expiring-")) {
      const expired = item.key.startsWith("licence-expired-");
      const row = licenceById.get(id(expired ? "licence-expired-" : "licence-expiring-"));
      if (!row) continue;
      rows.push({
        key: item.key,
        kind: expired ? "licence-expired" : "licence-expiring",
        label: expired ? "Licence expired" : "Licence expires",
        state: row.state,
        carrierId: null,
        carrierLabel: null,
        due: row.expires_at,
        chip: expired ? { tone: "danger", label: "Expired" } : { tone: "warning", label: daysLeft(item.days) },
        next: "Renew",
        detail: item.body,
      });
    } else if (item.key.startsWith("licence-missing")) {
      // One item for one state ("licence-missing-TX"), one grouped item for several ("licence-missing").
      const states = item.key.startsWith("licence-missing-") ? [id("licence-missing-")] : unlicensed;
      for (const state of states) {
        const carriers = carriersIn(state);
        rows.push({
          key: `licence-missing-${state}`,
          kind: "licence-missing",
          label: "Appointed, not licensed",
          state,
          carrierId: carriers.length === 1 ? carriers[0] : null,
          carrierLabel: carriers.length === 0 ? null : carriers.length === 1 ? nameOf(carriers[0]) : `${nameOf(carriers[0])} +${carriers.length - 1}`,
          due: null,
          chip: { tone: "danger", label: "Can't write" },
          next: "Add licence",
          detail: `Appointed in ${stateName(state)}, but no state licence is on file. ${stateName(state)} leads cannot be assigned.`,
        });
      }
    } else if (item.key.startsWith("training-")) {
      const row = trainingById.get(id("training-"));
      if (!row) continue;
      const overdue = item.days < 0;
      rows.push({
        key: item.key,
        kind: overdue ? "training-overdue" : "training-due",
        label: overdue ? "Training overdue" : "Training due",
        state: null,
        carrierId: row.carrier_id,
        carrierLabel: nameOf(row.carrier_id),
        due: row.due_on,
        chip: overdue ? { tone: "danger", label: "Overdue" } : { tone: "warning", label: daysLeft(item.days) },
        next: "Open",
        detail: item.body,
      });
    }
  }
  return rows;
}

export type CarrierLine = {
  carrierId: string;
  /** Appointed and in date today (including inside the expiry window). */
  appointed: number;
  pending: number;
  endedOrExpired: number;
  chip: Chip;
};

/**
 * One line a carrier: how many states it has appointed you in, pending, ended or expired, and its worst problem
 * as one chip. "Unlicensed" counts the appointed states with no licence, or with one that has expired.
 */
export function carrierLines(
  carrierIds: readonly string[],
  appointments: ReadinessInput["appointments"],
  licenses: readonly Pick<LicenseRow, "state" | "expires_at">[],
  today: string,
): CarrierLine[] {
  const latest = [...latestAppointmentByCell(appointments).values()];
  const licence = new Map(licenses.map((row) => [row.state, row]));
  const canWrite = (state: string) => {
    const row = licence.get(state);
    return Boolean(row) && daysUntilExpiry(row!.expires_at, today) >= 0;
  };
  return carrierIds.map((carrierId) => {
    let appointed = 0, pending = 0, ended = 0, expired = 0, expiring = 0, unlicensed = 0;
    for (const row of latest) {
      if (row.carrier_id !== carrierId) continue;
      const status = appointmentCellStatus(row, today);
      if (status.kind === "appointed" || status.kind === "expiring") {
        appointed += 1;
        if (status.kind === "expiring") expiring += 1;
        if (!canWrite(row.state)) unlicensed += 1;
      } else if (status.kind === "pending") pending += 1;
      else if (status.kind === "expired") expired += 1;
      else if (status.kind === "ended") ended += 1;
    }
    const chip: Chip =
      expired ? { tone: "danger", label: `${expired} expired` }
      : unlicensed ? { tone: "danger", label: `${unlicensed} ${unlicensed === 1 ? "state" : "states"} unlicensed` }
      : expiring ? { tone: "warning", label: `${expiring} expiring` }
      : pending ? { tone: "warning", label: `${pending} pending` }
      : appointed ? { tone: "good", label: "Ready" }
      : { tone: "neutral", label: "No appointments" };
    return { carrierId, appointed, pending, endedOrExpired: ended + expired, chip };
  });
}

/** One chip a licence row: Expired, N days left, No number, else Current. */
export function licenceChip(row: Pick<LicenseRow, "expires_at"> & { number: string; hasExpiry: boolean }, today: string, windowDays = 60): Chip {
  if (row.hasExpiry) {
    const days = daysUntilExpiry(row.expires_at, today);
    if (days < 0) return { tone: "danger", label: "Expired" };
    if (days <= windowDays) return { tone: "warning", label: daysLeft(days) };
  }
  if (!row.number) return { tone: "warning", label: "No number" };
  return { tone: "good", label: "Current" };
}

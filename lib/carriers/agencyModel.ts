// LA-0.4 · the agency's carriers, decided in one place: Settings › Carriers. Client-safe rules; the
// read is agency.ts. Owner, 2026-11-02: "whenever we select in the settings which carrier we work
// with, I want that directly implemented into every single thing that requires a carrier".
//
// A carrier is the agency's when Settings shows it in "Your carriers": it holds a current contract
// (tenant_carriers.is_active) or has a switch row (tenant_carrier_requirements). It is on unless that
// switch says contracted = false. Its states are the ones it is appointed in today (LA-0.5 / LA-3.6;
// pending never counts, as in eligibility.ts).
//
// Pickers offer only carriers that are on (and, where a state is known, appointed there). Lists of
// records already made keep every carrier those records name: history is never hidden.

import { appointmentIsActiveAt } from "../appointments/eligibility.ts";
import type { AppointmentRow } from "../appointments/service-types.ts";

export type AgencyCarrier = {
  id: string;
  code: string;
  name: string;
  /** Switched on in Settings › Carriers. Off = still the agency's history, never offered for new work. */
  on: boolean;
  /** Two-letter states it is appointed in today, sorted. */
  states: string[];
};

export type CarrierOption = { id: string; code: string; name: string };

type LibraryRow = { id: string; code?: string | null; name: string };
/** An appointment as the vault reads it; whether it counts today is eligibility.ts's call. */
export type AgencyAppointment = Parameters<typeof appointmentIsActiveAt>[0] & Pick<AppointmentRow, "carrier_id" | "state">;

/** The agency's carriers, on and off, in the library's order. */
export function agencyCarrierModel(input: {
  library: LibraryRow[];
  contracts: Array<{ carrier_id: string; is_active: boolean }>;
  requirements: Array<{ carrier_id: string; contracted: boolean }>;
  appointments: AgencyAppointment[];
  today: string;
}): AgencyCarrier[] {
  const yours = new Set([
    ...input.contracts.filter((row) => row.is_active).map((row) => row.carrier_id),
    ...input.requirements.map((row) => row.carrier_id),
  ]);
  const off = new Set(input.requirements.filter((row) => row.contracted === false).map((row) => row.carrier_id));
  const states = new Map<string, Set<string>>();
  for (const row of input.appointments) {
    if (!appointmentIsActiveAt(row, input.today)) continue;
    const code = String(row.state ?? "").trim().toUpperCase();
    if (!code) continue;
    const set = states.get(row.carrier_id) ?? new Set<string>();
    set.add(code);
    states.set(row.carrier_id, set);
  }
  return input.library
    .filter((carrier) => yours.has(carrier.id))
    .map((carrier) => ({ id: carrier.id, code: carrier.code ?? "", name: carrier.name, on: !off.has(carrier.id), states: [...(states.get(carrier.id) ?? [])].sort() }));
}

/**
 * What a picker for new work offers: carriers switched on, and when the client's state is known,
 * only those appointed there. No state = every carrier that is on.
 */
export function offeredCarriers(carriers: AgencyCarrier[], state?: string | null): AgencyCarrier[] {
  const code = state ? state.trim().toUpperCase() : "";
  return carriers.filter((carrier) => carrier.on && (!code || carrier.states.includes(code)));
}

/**
 * A filter over records: the carriers that are on, plus every carrier the records already name (a
 * switched-off or since-removed carrier keeps its policies, files and money visible). Sorted by name.
 */
export function carriersWithHistory(carriers: AgencyCarrier[], named: Array<{ id: string; name: string; code?: string | null }>): CarrierOption[] {
  const out = new Map<string, CarrierOption>();
  for (const carrier of carriers) if (carrier.on) out.set(carrier.id, { id: carrier.id, code: carrier.code, name: carrier.name });
  for (const carrier of named) if (carrier.id && !out.has(carrier.id)) out.set(carrier.id, { id: carrier.id, code: carrier.code ?? "", name: carrier.name });
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

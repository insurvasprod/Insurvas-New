import type { AppointmentRow, LicenseRow } from "@/lib/appointments/service-types";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import type { CarriersPayload } from "@/lib/salesSettings/views";

/** What GET /api/app/appointment-vault answers: the carrier list, contracts, appointments and licences. */
export type Vault = {
  carriers: { id: string; name: string }[];
  tenantCarriers: TenantCarrierRow[];
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  extendedFields: boolean;
  carrierRequirements: { carrier_id: string; contracted: boolean }[] | null;
};

/** Settings › Sales › Carriers (the Applications feature): products, portal and field map per carrier. */
export type Sales = (Omit<CarriersPayload, "canEdit"> & { canEdit: boolean }) | null;

/** A person who may write: an owner, admin, agent or team lead who is active, with the states they are licensed in. */
export type Writer = { id: string; name: string; states: string[] };

/** A carrier's latest commission file (Carrier files), when the agency reads them. */
export type FileSummary = { date: string; rows: number | null; needsMatching: boolean; held: number };

/** The figures the Rate card keeps for a carrier, shown read-only on its sheet. */
export type RateFacts = { renewalPct: number | null; advanceMonths: number | null; chargebackMonths: number | null };

export type Send = (url: string, method: string, body?: unknown) => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>;

export const sendJson: Send = async (url, method, body) => {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  return response.ok ? { ok: true, data } : { ok: false, error: (data as { error?: string } | null)?.error ?? "That could not be saved" };
};

/**
 * The writers who can sell a carrier in a state: licensed there personally, or with no personal licences
 * recorded (lead assignment then judges them on the agency's licences, lib/tenantTeam).
 */
export function writersIn(writers: Writer[], state: string) {
  return writers.filter((writer) => writer.states.length === 0 || writer.states.includes(state));
}

export function writersFor(writers: Writer[], states: string[]) {
  return writers
    .map((writer) => ({ ...writer, here: writer.states.length === 0 ? states : writer.states.filter((state) => states.includes(state)) }))
    .filter((writer) => writer.here.length > 0);
}

export const listOut = (codes: string[], max = 4) => (codes.length > max ? `${codes.slice(0, max).join(", ")} +${codes.length - max}` : codes.join(", "));

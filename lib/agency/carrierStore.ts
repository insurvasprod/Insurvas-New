import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema } from "@/lib/appointments/pendingSchema";
import { spreadBps } from "./overrideCore";

/**
 * AG-0.9 · one producer's carriers: his level and the agency's, his writing number, his appointments — each with
 * its dates. A missing level or number is null and the screen prompts for it; it is never filled from the
 * agency's figures. Writes go through set_producer_carrier (close the row in force, insert the new one).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type ProducerCarrierRow = {
  carrierId: string;
  carrierName: string;
  agencyLevelBps: number | null;
  producerLevelBps: number | null;
  levelFrom: string | null;
  spreadBps: number | null;
  writingNumber: string | null;
  numberFrom: string | null;
  appointments: Array<{ state: string; status: string; expiresOn: string | null }>;
};

export class CarrierRefusal extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const inForce = (r: { effective_from: string; effective_to: string | null }, d: string) => r.effective_from <= d && (!r.effective_to || d <= r.effective_to);

export async function readProducerCarriers(tenantId: string, producerId: string): Promise<{ schemaPending: boolean; rows: ProducerCarrierRow[] }> {
  const [agencyRows, levels, numbers, appts] = await Promise.all([
    db().from("tenant_carriers").select("carrier_id, contract_level_bp, effective_from, carriers(name)").eq("tenant_id", tenantId),
    db().from("producer_contract_level").select("carrier_id, level_bps, effective_from, effective_to").eq("tenant_id", tenantId).eq("producer_id", producerId),
    db().from("producer_writing_number").select("carrier_id, writing_number, effective_from, effective_to").eq("tenant_id", tenantId).eq("producer_id", producerId),
    db().from("producer_appointment").select("carrier_id, state, status, expires_on").eq("tenant_id", tenantId).eq("producer_id", producerId),
  ]);
  if ([levels.error, numbers.error, appts.error].some((e) => e && isPendingSchema(e))) return { schemaPending: true, rows: [] };
  const d = today();
  // The agency's current level per carrier (latest row on or before today).
  const agency = new Map<string, { bps: number; name: string }>();
  for (const r of ((agencyRows.data ?? []) as Array<{ carrier_id: string; contract_level_bp: number; effective_from: string; carriers: { name: string } | null }>)
    .filter((r) => r.effective_from <= d)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))) {
    agency.set(r.carrier_id, { bps: r.contract_level_bp, name: r.carriers?.name ?? "Carrier" });
  }
  const carrierIds = new Set<string>([...agency.keys()]);
  for (const r of (levels.data ?? []) as Array<{ carrier_id: string }>) carrierIds.add(r.carrier_id);
  for (const r of (numbers.data ?? []) as Array<{ carrier_id: string }>) carrierIds.add(r.carrier_id);
  const missingNames = [...carrierIds].filter((id) => !agency.has(id));
  const names = new Map<string, string>();
  if (missingNames.length) {
    const { data } = await db().from("carriers").select("id, name").in("id", missingNames);
    for (const c of (data ?? []) as Array<{ id: string; name: string }>) names.set(c.id, c.name);
  }
  const rows = [...carrierIds].map((carrierId): ProducerCarrierRow => {
    const level = ((levels.data ?? []) as Array<{ carrier_id: string; level_bps: number; effective_from: string; effective_to: string | null }>).find((r) => r.carrier_id === carrierId && inForce(r, d));
    const number = ((numbers.data ?? []) as Array<{ carrier_id: string; writing_number: string; effective_from: string; effective_to: string | null }>).find((r) => r.carrier_id === carrierId && inForce(r, d));
    const agencyBps = agency.get(carrierId)?.bps ?? null;
    return {
      carrierId,
      carrierName: agency.get(carrierId)?.name ?? names.get(carrierId) ?? "Carrier",
      agencyLevelBps: agencyBps,
      producerLevelBps: level?.level_bps ?? null,
      levelFrom: level?.effective_from ?? null,
      spreadBps: spreadBps(agencyBps, level?.level_bps ?? null),
      writingNumber: number?.writing_number ?? null,
      numberFrom: number?.effective_from ?? null,
      appointments: ((appts.data ?? []) as Array<{ carrier_id: string; state: string; status: string; expires_on: string | null }>)
        .filter((a) => a.carrier_id === carrierId)
        .map((a) => ({ state: a.state, status: a.status, expiresOn: a.expires_on }))
        .sort((a, b) => a.state.localeCompare(b.state)),
    };
  });
  return { schemaPending: false, rows: rows.sort((a, b) => a.carrierName.localeCompare(b.carrierName)) };
}

export async function setProducerCarrier(input: {
  tenantId: string;
  producerId: string;
  carrierId: string;
  levelBps: number | null;
  writingNumber: string | null;
  effectiveFrom: string;
  actorId: string;
}) {
  const { error } = await db().rpc("set_producer_carrier", {
    p_tenant_id: input.tenantId,
    p_producer_id: input.producerId,
    p_carrier_id: input.carrierId,
    p_level_bps: input.levelBps,
    p_writing_number: input.writingNumber,
    p_effective_from: input.effectiveFrom,
    p_actor: input.actorId,
  });
  if (!error) return;
  const message = error.message ?? "";
  if (/writing_number_taken|producer_writing_number_one_owner|producer_writing_number_unique_start/.test(message)) {
    throw new CarrierRefusal("Another producer in your agency already has this writing number for this carrier. One number belongs to one producer at a time.", "writing_number_taken", 409);
  }
  if (/level_same_day|hierarchy_same_day/.test(message)) throw new CarrierRefusal("A change already starts that day. Pick the next day.", "same_day", 409);
  if (/producer_not_found/.test(message)) throw new CarrierRefusal("That producer could not be found.", "producer_not_found", 404);
  if (isPendingSchema(error)) throw new CarrierRefusal("This needs the agency database update (20261018155000).", "schema_pending", 503);
  throw new Error(message);
}

export async function setProducerAppointment(input: { tenantId: string; producerId: string; carrierId: string; state: string; status: "pending" | "appointed" | "terminated"; effectiveFrom: string | null; expiresOn: string | null; actorId: string }) {
  const { data: producer } = await db().from("producer").select("agency_id").eq("tenant_id", input.tenantId).eq("id", input.producerId).maybeSingle();
  if (!producer) throw new CarrierRefusal("That producer could not be found.", "producer_not_found", 404);
  const { error } = await db().from("producer_appointment").upsert({
    tenant_id: input.tenantId,
    agency_id: producer.agency_id,
    producer_id: input.producerId,
    carrier_id: input.carrierId,
    state: input.state.toUpperCase(),
    status: input.status,
    effective_from: input.effectiveFrom,
    expires_on: input.expiresOn,
    updated_by: input.actorId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "producer_id,carrier_id,state" });
  if (error) {
    if (isPendingSchema(error)) throw new CarrierRefusal("This needs the agency database update (20261018155000).", "schema_pending", 503);
    throw new Error(error.message);
  }
}

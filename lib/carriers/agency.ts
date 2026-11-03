import "server-only";

import { cache } from "react";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema } from "./schemaGap";
import { agencyCarrierModel, carriersWithHistory, offeredCarriers, type AgencyAppointment, type AgencyCarrier, type CarrierOption } from "./agencyModel";

export type { AgencyCarrier, CarrierOption } from "./agencyModel";
export { carriersWithHistory, offeredCarriers } from "./agencyModel";

const db = () => getSupabaseServiceClient();
// file_registry is not in the generated types yet (as in lib/ingestion/registry.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const files = (): any => getSupabaseServiceClient().from("file_registry" as never);

/**
 * LA-0.4 · the one read of which carriers this agency works with and where: every carrier picker and
 * filter in the app starts here, so a carrier switched off in Settings › Carriers leaves them all at
 * once, and a state limits where it is offered. On and off carriers both come back (`on`); pickers use
 * offeredCarriers(), filters over records use carriersWithHistory().
 *
 * Before the switch's migrations (20260924220100, 20261013100000) every contracted carrier reads as on.
 * Cached per request.
 */
export const agencyCarriers = cache(async (tenantId: string): Promise<AgencyCarrier[]> => {
  const [library, contracts, requirements, appointments] = await Promise.all([
    db().from("carriers").select("id, code, name").is("organization_id", null).order("sort_order").order("name"),
    db().from("tenant_carriers").select("carrier_id, is_active").eq("tenant_id", tenantId).eq("is_active", true),
    readSwitch(tenantId),
    db().from("appointments").select("carrier_id, state, status, effective_from, terminated_at").eq("tenant_id", tenantId).eq("status", "active"),
  ]);
  const failed = [library, contracts, appointments].find((read) => read.error)?.error;
  if (failed) throw new Error(`Could not load your carriers: ${failed.message}`);
  return agencyCarrierModel({
    library: (library.data ?? []) as Array<{ id: string; code: string; name: string }>,
    contracts: (contracts.data ?? []) as Array<{ carrier_id: string; is_active: boolean }>,
    requirements,
    appointments: (appointments.data ?? []) as AgencyAppointment[],
    today: new Date().toISOString().slice(0, 10),
  });
});

/** The switch rows; a missing table or column means "nothing switched off" (never hide a carrier on a gap). */
async function readSwitch(tenantId: string): Promise<Array<{ carrier_id: string; contracted: boolean }>> {
  const read = (columns: string) => db().from("tenant_carrier_requirements" as never).select(columns).eq("tenant_id" as never, tenantId as never);
  let { data, error } = await read("carrier_id, contracted");
  if (error && isPendingSchema(error as { message: string; code?: string })) ({ data, error } = await read("carrier_id"));
  if (error) return [];
  return ((data ?? []) as unknown as Array<{ carrier_id: string; contracted?: boolean | null }>).map((row) => ({ carrier_id: row.carrier_id, contracted: row.contracted !== false }));
}

/** A picker for new work: the carriers switched on (appointed in `state` when one is given). */
export async function carrierPicker(tenantId: string, state?: string | null): Promise<CarrierOption[]> {
  return offeredCarriers(await agencyCarriers(tenantId), state).map(({ id, code, name }) => ({ id, code, name }));
}

/** The ids of the carriers switched on: a gate for writes that take a carrier for new work. */
export async function carrierIdsOn(tenantId: string): Promise<Set<string>> {
  return new Set(offeredCarriers(await agencyCarriers(tenantId)).map((carrier) => carrier.id));
}

/**
 * The carriers an agency's files can come from (Files upload): carriers switched on, plus any it
 * already holds files for, since a carrier switched off keeps paying on the policies written with it.
 */
export async function fileCarrierChoices(tenantId: string): Promise<CarrierOption[]> {
  const held = await files().select("carrier_id").eq("tenant_id", tenantId).not("carrier_id", "is", null).limit(5000);
  return carrierFilter(tenantId, ((held.data ?? []) as Array<{ carrier_id: string | null }>).map((row) => row.carrier_id));
}

/** The upload door's gate: a carrier from fileCarrierChoices(). */
export async function acceptsFilesFrom(tenantId: string, carrierId: string): Promise<boolean> {
  if ((await carrierIdsOn(tenantId)).has(carrierId)) return true;
  const held = await files().select("id").eq("tenant_id", tenantId).eq("carrier_id", carrierId).limit(1);
  return Boolean(held.data?.length);
}

/**
 * A filter over records: carriers switched on plus every carrier `named` (the ids the records hold),
 * so history stays findable after a carrier is switched off.
 */
export async function carrierFilter(tenantId: string, namedIds: Iterable<string | null | undefined>): Promise<CarrierOption[]> {
  const ids = [...new Set([...namedIds].filter((id): id is string => Boolean(id)))];
  const [carriers, named] = await Promise.all([
    agencyCarriers(tenantId),
    ids.length ? db().from("carriers").select("id, code, name").in("id", ids) : Promise.resolve({ data: [] as Array<{ id: string; code: string; name: string }> }),
  ]);
  return carriersWithHistory(carriers, (named.data ?? []) as Array<{ id: string; code: string; name: string }>);
}

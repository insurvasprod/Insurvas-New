import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { CarrierRow } from "./constants";
import { isPendingSchema } from "./schemaGap";
import type { CarrierBlockingUsage, CarrierUsage, CarrierUsageSnapshot } from "./usage";

/**
 * The staff console's reads and writes of the PLATFORM carrier library (organization_id is null —
 * the rows tenants pick from; organization-era CRM rows are not part of it). Usage and the guarded
 * write come from migration 20260924357000 and fall back when it is not applied.
 */

export const CARRIER_COLUMNS = "id, code, name, is_active, sort_order, created_at, updated_at";

type Failure = { message: string; code?: string; details?: string | null } | null;

/** A missing function: PostgREST's PGRST202, Postgres's 42883, or the schema-cache message. */
function missing(error: Failure) {
  return Boolean(error && (error.code === "42883" || isPendingSchema(error)));
}

const db = () => getSupabaseServiceClient();

export async function listPlatformCarriers(options: { activeOnly?: boolean } = {}): Promise<CarrierRow[]> {
  let query = db().from("carriers").select(CARRIER_COLUMNS).is("organization_id", null).order("sort_order").order("name");
  if (options.activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw new Error("Could not load carriers");
  return (data ?? []) as CarrierRow[];
}

export async function getPlatformCarrier(id: string): Promise<CarrierRow | null> {
  const { data, error } = await db().from("carriers").select(CARRIER_COLUMNS).eq("id", id).is("organization_id", null).maybeSingle();
  if (error) throw new Error("Could not load carrier");
  return (data ?? null) as CarrierRow | null;
}

export async function platformCodeTaken(code: string): Promise<boolean> {
  const { data, error } = await db().from("carriers").select("id").eq("code", code).is("organization_id", null).limit(1);
  if (error) throw new Error("Could not check the carrier code");
  return (data ?? []).length > 0;
}

type UsageRow = { carrier_id: string; tenants: number; contract_tenants: number; appointment_tenants: number; open_appointments: number; appointments: number };
type TotalsRow = { tenants: number; appointments: number; open_appointments: number };

const toUsage = (row: UsageRow): CarrierUsage => ({
  carrierId: row.carrier_id,
  tenants: Number(row.tenants),
  contractTenants: Number(row.contract_tenants),
  appointmentTenants: Number(row.appointment_tenants),
  openAppointments: Number(row.open_appointments),
  appointments: Number(row.appointments),
});

/** Usage for every platform carrier. `available: false` before the migration — shown as unknown. */
export async function readCarrierUsage(): Promise<CarrierUsageSnapshot> {
  const client = db();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the functions are not in the shared generated types yet
  const rpc = client.rpc.bind(client) as any;
  const [usage, totals] = await Promise.all([rpc("admin_carrier_usage"), rpc("admin_carrier_usage_totals")]);
  if (missing(usage.error) || missing(totals.error)) return { available: false };
  if (usage.error || totals.error) throw new Error("Could not load carrier usage");
  const byCarrier: Record<string, CarrierUsage> = {};
  for (const row of (usage.data ?? []) as UsageRow[]) byCarrier[row.carrier_id] = toUsage(row);
  const total = ((totals.data ?? []) as TotalsRow[])[0];
  return {
    available: true,
    byCarrier,
    totals: { tenants: Number(total?.tenants ?? 0), appointments: Number(total?.appointments ?? 0), openAppointments: Number(total?.open_appointments ?? 0) },
  };
}

/**
 * What stands in the way of deactivating one carrier. Through admin_carrier_usage when it exists;
 * before that, exact counts of active contracts (one active row per tenant and carrier, so also the
 * contract tenants) and open appointments — distinct tenants unknown.
 */
export async function blockingUsage(carrierId: string): Promise<CarrierBlockingUsage> {
  const client = db();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not in the shared generated types yet
  const viaRpc = await (client.rpc.bind(client) as any)("admin_carrier_usage", { p_carrier_id: carrierId });
  if (!viaRpc.error) {
    const row = ((viaRpc.data ?? []) as UsageRow[])[0];
    if (!row) return { tenants: 0, contractTenants: 0, appointmentTenants: 0, openAppointments: 0 };
    const usage = toUsage(row);
    return { tenants: usage.tenants, contractTenants: usage.contractTenants, appointmentTenants: usage.appointmentTenants, openAppointments: usage.openAppointments };
  }
  if (!missing(viaRpc.error)) throw new Error("Could not count who uses this carrier");

  const today = new Date().toISOString().slice(0, 10);
  const [contracts, appointments] = await Promise.all([
    db().from("tenant_carriers").select("id", { count: "exact", head: true }).eq("carrier_id", carrierId).eq("is_active", true),
    db()
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("carrier_id", carrierId)
      .neq("status", "terminated")
      .or(`terminated_at.is.null,terminated_at.gte.${today}`),
  ]);
  if (contracts.error || appointments.error) throw new Error("Could not count who uses this carrier");
  return { tenants: null, contractTenants: contracts.count ?? 0, appointmentTenants: null, openAppointments: appointments.count ?? 0 };
}

export type SetActiveResult =
  | { ok: true; carrier: CarrierRow }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "in_use"; usage: CarrierBlockingUsage | null };

/**
 * Activates or deactivates a platform carrier. `overrideReason` (already checked by the route:
 * super_admin, 10+ characters) is passed to admin_set_carrier_active, which raises the
 * transaction-local override for its own update only. Before the migration there is no trigger and
 * no RPC; the route's own check has run, and this is a plain update that keeps `status` in step.
 */
export async function setCarrierActive(id: string, isActive: boolean, overrideReason: string | null): Promise<SetActiveResult> {
  const client = db();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not in the shared generated types yet
  const viaRpc = await (client.rpc.bind(client) as any)("admin_set_carrier_active", { p_carrier_id: id, p_is_active: isActive, p_override_reason: overrideReason });
  if (!viaRpc.error) {
    const row = ((viaRpc.data ?? []) as CarrierRow[])[0];
    return row ? { ok: true, carrier: row } : { ok: false, reason: "not_found" };
  }
  const error = viaRpc.error as Failure;
  if (error?.code === "P0002" || /carrier_not_found/.test(error?.message ?? "")) return { ok: false, reason: "not_found" };
  if (/carrier_in_use/.test(error?.message ?? "")) return { ok: false, reason: "in_use", usage: parseTriggerUsage(error?.details ?? null) };
  if (!missing(error)) throw new Error("Could not change the carrier");

  const { data, error: updateError } = await db()
    .from("carriers")
    .update({ is_active: isActive, status: isActive ? "active" : "archived" } as never)
    .eq("id", id)
    .is("organization_id", null)
    .select(CARRIER_COLUMNS)
    .maybeSingle();
  if (updateError) throw new Error("Could not change the carrier");
  return data ? { ok: true, carrier: data as CarrierRow } : { ok: false, reason: "not_found" };
}

/** The trigger puts its counts in DETAIL as JSON; anything else reads as "counts unavailable". */
function parseTriggerUsage(details: string | null): CarrierBlockingUsage | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as Partial<UsageRow>;
    return {
      tenants: Number(parsed.tenants ?? 0),
      contractTenants: Number(parsed.contract_tenants ?? 0),
      appointmentTenants: Number(parsed.appointment_tenants ?? 0),
      openAppointments: Number(parsed.open_appointments ?? 0),
    };
  } catch {
    return null;
  }
}

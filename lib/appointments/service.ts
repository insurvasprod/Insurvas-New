import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import type { CarrierRow } from "@/lib/carriers/constants";
import type { TenantCarrierRow } from "@/lib/carriers/service";
import type { AppointmentRow, AppointmentStatus, CarrierTrainingRow, CeRecordRow, EoPolicyRow, LicenseRow } from "./service-types";
import { canWriteFromVault } from "./eligibility";
import { isPendingSchema, SchemaPendingError } from "./pendingSchema";

export type AppointmentVault = {
  carriers: CarrierRow[];
  tenantCarriers: TenantCarrierRow[];
  appointments: AppointmentRow[];
  licenses: LicenseRow[];
  eoPolicies: EoPolicyRow[];
  ceRecords: CeRecordRow[];
  /** False until migration 20260924110000 is applied: licence type/lines, E&O limits and ethics credits cannot be stored yet. */
  extendedFields: boolean;
  /** Carriers whose contract requires E&O in force (migration 20260924220100); null before it. */
  carrierRequirements: Array<{ carrier_id: string; requires_eo: boolean }> | null;
  /** False until migration 20260924310000: an appointment cannot be pending or carry an expiry yet. */
  appointmentDetails: boolean;
  /** Carrier-specific trainings (migration 20260924310100); null before it. */
  carrierTrainings: CarrierTrainingRow[] | null;
};

const LICENCE_BASE = "id, tenant_id, state, license_number, expires_at, created_at, updated_at";
const EO_BASE = "id, tenant_id, carrier, policy_number, expires_at, coverage_amount_cents, created_at, updated_at";
const CE_BASE = "id, tenant_id, state, credits_required, credits_completed, deadline, created_at, updated_at";
const LICENCE_EXTENDED = `${LICENCE_BASE}, licence_type, lines_of_authority`;
const EO_EXTENDED = `${EO_BASE}, per_claim_cents, aggregate_cents`;
const CE_EXTENDED = `${CE_BASE}, ethics_required, ethics_completed`;
const APPOINTMENT_BASE = "id, tenant_id, carrier_id, state, status, effective_from, terminated_at, created_at, updated_at";
const APPOINTMENT_DETAILED = `${APPOINTMENT_BASE}, expires_at`;
const TRAINING_COLUMNS = "id, tenant_id, carrier_id, title, due_on, completed_on, updated_at, updated_by";

export async function getAppointmentVault(tenantId: string): Promise<AppointmentVault> {
  const supabase = getSupabaseServiceClient();
  // The three record tables are asked for their new columns first; if migration 20260924110000 is
  // not applied yet that is a schema gap, not a fault, and they are asked again for what they had.
  const records = async (extended: boolean) => Promise.all([
    supabase.from("licenses").select(extended ? LICENCE_EXTENDED : LICENCE_BASE).eq("tenant_id", tenantId).order("state"),
    supabase.from("eo_policies").select(extended ? EO_EXTENDED : EO_BASE).eq("tenant_id", tenantId).order("expires_at"),
    supabase.from("ce_records").select(extended ? CE_EXTENDED : CE_BASE).eq("tenant_id", tenantId).order("state"),
  ]);
  // expires_at and 'pending' arrive with 20260924310000; before it the appointments are read as they were.
  const appointmentRows = (detailed: boolean) =>
    supabase.from("appointments").select(detailed ? APPOINTMENT_DETAILED : APPOINTMENT_BASE).eq("tenant_id", tenantId).order("effective_from", { ascending: false }).order("created_at", { ascending: false });
  const [carriers, tenantCarriers, firstAppointments, firstRecords, requirements, trainings] = await Promise.all([
    supabase.from("carriers").select("id, code, name, is_active, sort_order, created_at, updated_at").is("organization_id", null).eq("is_active", true).order("sort_order").order("name"),
    supabase.from("tenant_carriers").select("id, tenant_id, carrier_id, contract_level_bp, writing_number, effective_from, is_active, created_at").eq("tenant_id", tenantId).order("effective_from", { ascending: false }),
    appointmentRows(true),
    records(true),
    // Garnish for the E&O callout: a missing table or a failed read counts nothing rather than guessing.
    supabase.from("tenant_carrier_requirements" as never).select("carrier_id, requires_eo").eq("tenant_id" as never, tenantId as never),
    supabase.from("tenant_carrier_training" as never).select(TRAINING_COLUMNS).eq("tenant_id" as never, tenantId as never).order("due_on" as never),
  ]);
  const appointmentDetails = !isPendingSchema(firstAppointments.error);
  const appointments = appointmentDetails ? firstAppointments : await appointmentRows(false);
  // A missing training table means "not recordable yet"; any other failure is a fault like the rest.
  const carrierTrainingsMissing = isPendingSchema(trainings.error);
  if (trainings.error && !carrierTrainingsMissing) throw new Error(`Could not load appointment vault: ${trainings.error.message}`);
  const extendedFields = !firstRecords.some((result) => isPendingSchema(result.error));
  const [licenses, eoPolicies, ceRecords] = extendedFields ? firstRecords : await records(false);
  const error = [carriers, tenantCarriers, appointments, licenses, eoPolicies, ceRecords].find((result) => result.error)?.error;
  if (error) throw new Error(`Could not load appointment vault: ${error.message}`);
  return { carriers: (carriers.data ?? []) as CarrierRow[], tenantCarriers: (tenantCarriers.data ?? []) as TenantCarrierRow[], appointments: (appointments.data ?? []) as unknown as AppointmentRow[], licenses: (licenses.data ?? []) as unknown as LicenseRow[], eoPolicies: (eoPolicies.data ?? []) as unknown as EoPolicyRow[], ceRecords: (ceRecords.data ?? []) as unknown as CeRecordRow[], extendedFields, carrierRequirements: requirements.error ? null : ((requirements.data ?? []) as unknown as Array<{ carrier_id: string; requires_eo: boolean }>), appointmentDetails, carrierTrainings: carrierTrainingsMissing ? null : ((trainings.data ?? []) as unknown as CarrierTrainingRow[]) };
}

export type AppointmentInput = {
  id?: string;
  carrier_id: string;
  state: string;
  status: AppointmentStatus;
  effective_from: string;
  terminated_at?: string | null;
  expires_at?: string | null;
};

function appointmentSaveError(error: { message: string; code?: string }) {
  if (/appointment_not_found/.test(error.message)) return new Error("That appointment is no longer on file. Reload the page and try again.");
  if (error.code === "23505") return new Error("This carrier already has an appointment in that state starting on that date.");
  return new Error(error.message);
}

/**
 * One statement for the whole batch. save_appointments_with_details (20260924310000) stores
 * 'pending' and expires_at and can edit a row by id. Until it is applied the LA-0.5
 * save_appointments takes the batch, and a row it cannot store faithfully is refused whole (503)
 * rather than saved without the part that made it pending or expiring.
 */
export async function saveAppointments(tenantId: string, rows: AppointmentInput[]) {
  const client = getSupabaseServiceClient();
  const detailed = await client.rpc("save_appointments_with_details" as never, { p_tenant_id: tenantId, p_rows: rows as unknown as Json } as never);
  if (!detailed.error) return (detailed.data ?? []) as unknown as AppointmentRow[];
  if (!isPendingSchema(detailed.error)) throw appointmentSaveError(detailed.error);

  if (rows.some((row) => row.status === "pending" || (row.expires_at !== undefined && row.expires_at !== null))) throw new SchemaPendingError();
  // The old function upserts on carrier + state + effective date. An edit by id is that same write
  // only while it keeps the row's own carrier, state and date; moving the date needs the new function.
  const ids = rows.flatMap((row) => (row.id ? [row.id] : []));
  if (ids.length) {
    const stored = await client.from("appointments").select("id, carrier_id, state, effective_from").eq("tenant_id", tenantId).in("id", ids);
    if (stored.error) throw new Error(stored.error.message);
    const byId = new Map((stored.data ?? []).map((row) => [row.id, row]));
    for (const row of rows) {
      if (!row.id) continue;
      const current = byId.get(row.id);
      if (!current) throw new Error("That appointment is no longer on file. Reload the page and try again.");
      if (current.carrier_id !== row.carrier_id || current.state !== row.state || current.effective_from !== row.effective_from) throw new SchemaPendingError();
    }
  }
  const legacy = rows.map((row) => ({ carrier_id: row.carrier_id, state: row.state, status: row.status, effective_from: row.effective_from, terminated_at: row.terminated_at ?? null }));
  const { data, error } = await client.rpc("save_appointments", { p_tenant_id: tenantId, p_rows: legacy as Json });
  if (error) throw appointmentSaveError(error);
  return (data ?? []) as unknown as AppointmentRow[];
}

/* -- carrier-specific trainings (20260924310100) -------------------------------------------- */

type LooseResult = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
type LooseFilter = { eq(column: string, value: string): LooseFilter; select(columns: string): { single(): LooseResult; maybeSingle(): LooseResult } };
type TrainingTable = {
  insert(values: Record<string, unknown>): { select(columns: string): { single(): LooseResult } };
  update(values: Record<string, unknown>): LooseFilter;
  delete(): LooseFilter;
};
// Not in the generated types until the migration is applied and the types regenerated.
const trainingTable = () => (getSupabaseServiceClient() as unknown as { from(table: string): TrainingTable }).from("tenant_carrier_training");

export class TrainingNotFoundError extends Error {
  constructor() {
    super("That training is no longer on file. Reload the page and try again.");
    this.name = "TrainingNotFoundError";
  }
}

export async function addCarrierTraining(tenantId: string, actorId: string, input: { carrier_id: string; title: string; due_on: string }) {
  const { data, error } = await trainingTable()
    .insert({ tenant_id: tenantId, carrier_id: input.carrier_id, title: input.title, due_on: input.due_on, updated_by: actorId })
    .select(TRAINING_COLUMNS)
    .single();
  if (isPendingSchema(error)) throw new SchemaPendingError();
  if (error?.code === "23503") throw new Error("Choose a carrier from the carrier library");
  if (error || !data) throw new Error(error?.message ?? "Could not save the training");
  return data as CarrierTrainingRow;
}

export async function completeCarrierTraining(tenantId: string, actorId: string, id: string, completedOn: string | null) {
  const { data, error } = await trainingTable()
    .update({ completed_on: completedOn, updated_by: actorId, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select(TRAINING_COLUMNS)
    .maybeSingle();
  if (isPendingSchema(error)) throw new SchemaPendingError();
  if (error) throw new Error(error.message);
  if (!data) throw new TrainingNotFoundError();
  return data as CarrierTrainingRow;
}

export async function removeCarrierTraining(tenantId: string, id: string) {
  const { data, error } = await trainingTable().delete().eq("tenant_id", tenantId).eq("id", id).select(TRAINING_COLUMNS).maybeSingle();
  if (isPendingSchema(error)) throw new SchemaPendingError();
  if (error) throw new Error(error.message);
  if (!data) throw new TrainingNotFoundError();
  return data as CarrierTrainingRow;
}

type Extras = Record<string, unknown>;
const definedExtras = (extras: Extras) => Object.fromEntries(Object.entries(extras).filter(([, value]) => value !== undefined));
const carriesValue = (extras: Extras) => Object.values(extras).some((value) => value !== null && !(Array.isArray(value) && value.length === 0));

/**
 * Writes the columns migration 20260924110000 adds, after the LA-0.5 RPC has written the rest.
 *
 * Probed before the RPC runs, so a request that needs the new columns is refused whole (503) rather
 * than half-saved. A request whose new fields are all empty is saved normally on either schema.
 */
async function probeExtras(table: "licenses" | "eo_policies" | "ce_records", extras: Extras): Promise<boolean> {
  const keys = Object.keys(extras);
  if (keys.length === 0) return false;
  const probe = await getSupabaseServiceClient().from(table).select(keys.join(", ")).limit(0);
  if (isPendingSchema(probe.error)) {
    if (carriesValue(extras)) throw new SchemaPendingError();
    return false;
  }
  if (probe.error) throw new Error(probe.error.message);
  return true;
}
async function writeExtras<T extends { id: string }>(table: "licenses" | "eo_policies" | "ce_records", row: T, extras: Extras): Promise<T> {
  const { data, error } = await getSupabaseServiceClient().from(table).update(extras as never).eq("id", row.id).select("*").single();
  if (isPendingSchema(error)) throw new SchemaPendingError();
  if (error || !data) throw new Error(error?.message ?? "Could not save the record");
  return data as unknown as T;
}

/**
 * One statement for the whole record (migration 20260924220300), so a failure can never leave the
 * original columns saved and the new ones not. Returns null when that function is not there yet —
 * the caller then takes the two-step path, which probes first so it still refuses rather than
 * half-saves a request that needs the new columns.
 */
async function saveAtomically<T>(fn: string, args: Record<string, unknown>, extras: Extras): Promise<T | null> {
  const { data, error } = await getSupabaseServiceClient().rpc(fn as never, { ...args, p_details: extras } as never).single();
  if (error && isPendingSchema(error)) return null;
  if (error || !data) throw new Error(error?.message ?? "Could not save the record");
  return data as T;
}

export async function saveLicense(tenantId: string, input: { state: string; license_number: string; expires_at: string; licence_type?: string | null; lines_of_authority?: string[] }) {
  const extras = definedExtras({ licence_type: input.licence_type, lines_of_authority: input.lines_of_authority });
  const atomic = await saveAtomically<LicenseRow>("save_license_with_details", { p_tenant_id: tenantId, p_state: input.state, p_license_number: input.license_number, p_expires_at: input.expires_at }, extras);
  if (atomic) return atomic;
  const writeNew = await probeExtras("licenses", extras);
  const { data, error } = await getSupabaseServiceClient().rpc("save_license", { p_tenant_id: tenantId, p_state: input.state, p_license_number: input.license_number, p_expires_at: input.expires_at }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save licence");
  return writeNew ? writeExtras("licenses", data as LicenseRow, extras) : (data as LicenseRow);
}
export async function saveEoPolicy(tenantId: string, input: { carrier: string; policy_number: string; expires_at: string; coverage_amount_cents: number; per_claim_cents?: number | null; aggregate_cents?: number | null }) {
  const extras = definedExtras({ per_claim_cents: input.per_claim_cents, aggregate_cents: input.aggregate_cents });
  const atomic = await saveAtomically<EoPolicyRow>("save_eo_policy_with_limits", { p_tenant_id: tenantId, p_carrier: input.carrier, p_policy_number: input.policy_number, p_expires_at: input.expires_at, p_coverage_amount_cents: input.coverage_amount_cents }, extras);
  if (atomic) return atomic;
  const writeNew = await probeExtras("eo_policies", extras);
  const { data, error } = await getSupabaseServiceClient().rpc("save_eo_policy", { p_tenant_id: tenantId, p_carrier: input.carrier, p_policy_number: input.policy_number, p_expires_at: input.expires_at, p_coverage_amount_cents: input.coverage_amount_cents }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save E&O policy");
  return writeNew ? writeExtras("eo_policies", data as EoPolicyRow, extras) : (data as EoPolicyRow);
}
export async function saveCeRecord(tenantId: string, input: { state: string; credits_required: number; credits_completed: number; deadline: string; ethics_required?: number | null; ethics_completed?: number | null }) {
  const extras = definedExtras({ ethics_required: input.ethics_required, ethics_completed: input.ethics_completed });
  const atomic = await saveAtomically<CeRecordRow>("save_ce_record_with_ethics", { p_tenant_id: tenantId, p_state: input.state, p_credits_required: input.credits_required, p_credits_completed: input.credits_completed, p_deadline: input.deadline }, extras);
  if (atomic) return atomic;
  const writeNew = await probeExtras("ce_records", extras);
  const { data, error } = await getSupabaseServiceClient().rpc("save_ce_record", { p_tenant_id: tenantId, p_state: input.state, p_credits_required: input.credits_required, p_credits_completed: input.credits_completed, p_deadline: input.deadline }).single();
  if (error || !data) throw new Error(error?.message ?? "Could not save CE record");
  return writeNew ? writeExtras("ce_records", data as CeRecordRow, extras) : (data as CeRecordRow);
}

export async function canWrite(tenantId: string, carrierId: string, state: string, asOf: string): Promise<boolean> {
  const vault = await getAppointmentVault(tenantId);
  return canWriteFromVault(vault, carrierId, state, asOf);
}

export { canWriteFromVault } from "./eligibility";

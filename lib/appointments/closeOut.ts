import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Result<T> = { data: T; error: { message: string } | null };
type Query<T> = PromiseLike<Result<T>> & {
  select(columns: string): Query<T>;
  eq(column: string, value: unknown): Query<T>;
  in(column: string, values: unknown[]): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
};
type Db = {
  from(table: string): Query<Array<Record<string, unknown>>>;
  rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>>;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

export type CloseOutAppointment = {
  appointmentId: string;
  leadId: string;
  customerName: string;
  customerTimezone: string;
  startsAtLocal: string;
  note: string | null;
  waitingFor: string | null;
};

/**
 * LA-2.12, decision 12 · the appointments waiting for a mark.
 *
 * Reads `tenant_appointment_close_out`, which is every appointment parked at `pending` — past its
 * slot with no recorded activity near it. Decision 12: "three appointments, three buttons each.
 * Ten seconds."
 *
 * The customer's name is joined in from the lead rather than stored on the appointment, so the
 * strip shows who the appointment was with and not a uuid. A name is the only thing that makes the
 * row answerable without opening it.
 */
export async function listCloseOutAppointments(
  tenantId: string,
): Promise<CloseOutAppointment[]> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const rows = await db
    .from("tenant_appointment_close_out")
    .select(
      "appointment_id, lead_id, agent_user_id, booked_by, starts_at_utc, customer_timezone, notes, starts_at_local, waiting_for",
    )
    .eq("tenant_id", tenantId)
    .order("starts_at_utc", { ascending: true });
  if (rows.error)
    throw new Error(`Could not load appointments awaiting close-out: ${rows.error.message}`);

  const items = rows.data ?? [];
  if (items.length === 0) return [];

  const leadIds = [...new Set(items.map((row) => text(row.lead_id)).filter(Boolean))];
  const leads = leadIds.length
    ? await db.from("agent_leads").select("id, values").in("id", leadIds)
    : ({ data: [], error: null } as Result<Array<Record<string, unknown>>>);
  if (leads.error)
    throw new Error(`Could not load appointment leads: ${leads.error.message}`);

  const nameById = new Map<string, string>();
  for (const lead of leads.data ?? []) {
    const values = (lead.values ?? {}) as Record<string, unknown>;
    const name =
      text(values.full_name) ||
      [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ") ||
      "Unnamed lead";
    nameById.set(text(lead.id), name);
  }

  return items.map((row) => ({
    appointmentId: text(row.appointment_id),
    leadId: text(row.lead_id),
    customerName: nameById.get(text(row.lead_id)) ?? "Unnamed lead",
    customerTimezone: text(row.customer_timezone),
    startsAtLocal: text(row.starts_at_local) || text(row.starts_at_utc),
    note: text(row.notes) || null,
    waitingFor: text(row.waiting_for) || null,
  }));
}

/**
 * Records showed / no_show / cancelled / rescheduled against one pending appointment.
 *
 * The RPC owns every rule, and its raised codes are re-thrown unchanged so the route can map them:
 * `APPOINTMENT_NOT_ACTIVE`, `APPOINTMENT_OUTCOME_UNKNOWN`, `ACTOR_NOT_A_MEMBER`,
 * `SETTER_MAY_NOT_RECORD_OUTCOMES`. The last one matters most — a setter marking their own
 * appointments as shown is the measurement marking itself, which is exactly what decision 12's
 * "computed from actual outcomes, not self-reported" exists to prevent.
 */
export async function markCloseOutOutcome(input: {
  tenantId: string;
  appointmentId: string;
  actorId: string;
  outcome: "showed" | "no_show" | "cancelled" | "rescheduled";
}): Promise<void> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const result = await db.rpc("mark_appointment_outcome", {
    p_tenant_id: input.tenantId,
    p_appointment_id: input.appointmentId,
    p_actor: input.actorId,
    p_outcome: input.outcome,
  });
  // Thrown with the database's message intact. The route parses the leading token, so wrapping it
  // in friendlier prose here would turn every known refusal into a generic 503.
  if (result.error) throw new Error(result.error.message);
}

export type CloseOutSummary = {
  tenants: number;
  markedShowed: number;
  markedPending: number;
  failures: Array<{ tenantId: string; message: string }>;
};

/**
 * LA-2.12, decision 12 · the scheduled close-out pass.
 *
 * `close_out_due_appointments` has existed, correct and idempotent, and **nothing called it**. That
 * is the second finished mechanism with no caller found in this sweep, and here is what it cost:
 * decision 12 replaced "somebody marks every appointment" with a three-part rule, and the first two
 * parts live entirely inside that function.
 *
 *   (1) An appointment with any recorded activity near its slot is marked `showed` automatically.
 *       "Ray dispositioning the call IS the marking. Most appointments need zero extra clicks."
 *   (2) Anything past with no activity goes to `pending` — not `no_show` — so it surfaces in the
 *       close-out strip where a human can answer in ten seconds.
 *
 * Without the pass neither happens. Appointments sit at `booked` forever: never inferred as shown,
 * never parked as pending, so the strip is permanently empty and the show rate is computed over
 * whatever was marked by hand. Decision 12's whole point is that **a missing mark must never
 * silently become a penalty against a setter's pay** — and an unrun pass means almost every mark is
 * missing.
 *
 * Per tenant, because the function is. A failure for one tenant is collected and the loop
 * continues: one tenant's bad data must not stop every other tenant's appointments closing out,
 * and a job that stops half way through is worse than one that reports what it could not do.
 */
export async function processAppointmentCloseOut(
  input: { now?: Date } = {},
): Promise<CloseOutSummary> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const at = (input.now ?? new Date()).toISOString();

  // Only tenants that have an appointment at all. Enumerating every tenant would call the function
  // once per tenant on a platform where most have never booked one.
  const tenants = await db.from("tenant_appointments").select("tenant_id");
  if (tenants.error)
    throw new Error(`Could not list tenants with appointments: ${tenants.error.message}`);

  const ids = [...new Set((tenants.data ?? []).map((row) => text(row.tenant_id)).filter(Boolean))];
  const summary: CloseOutSummary = {
    tenants: ids.length,
    markedShowed: 0,
    markedPending: 0,
    failures: [],
  };

  for (const tenantId of ids) {
    const result = await db.rpc("close_out_due_appointments", {
      p_tenant_id: tenantId,
      p_at: at,
    });
    if (result.error) {
      summary.failures.push({ tenantId, message: result.error.message });
      continue;
    }
    const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
    const row = rows[0] as { marked_showed?: number; marked_pending?: number } | undefined;
    summary.markedShowed += Number(row?.marked_showed ?? 0);
    summary.markedPending += Number(row?.marked_pending ?? 0);
  }

  return summary;
}

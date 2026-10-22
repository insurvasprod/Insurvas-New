import "server-only";
import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { scopeFor, type ProducerScope } from "@/lib/agency/visibility";
import { appointmentVisible } from "./scopeCore";

export { appointmentVisible, calendarVisible } from "./scopeCore";

/**
 * AG-0.5 · for a route acting on ONE appointment by id (the rule is in ./scopeCore.ts): answered exactly
 * as an appointment that does not exist (404) when the session cannot see it. A missing appointment is
 * left to the route's own answer. Null scope (solo, all-seeing roles): no read.
 */
export async function guardAppointment(context: { tenantId: string; userId: string }, appointmentId: string, known?: ProducerScope): Promise<NextResponse | null> {
  const scope = known === undefined ? await scopeFor(context) : known;
  if (scope === null) return null;
  const { data, error } = await (getSupabaseServiceClient() as unknown as {
    from(table: string): { select(columns: string): { eq(c: string, v: string): { eq(c: string, v: string): { maybeSingle(): PromiseLike<{ data: { agent_user_id: string | null; booked_by: string | null } | null; error: { message: string } | null }> } } } };
  })
    .from("tenant_appointments")
    .select("agent_user_id, booked_by")
    .eq("tenant_id", context.tenantId)
    .eq("id", appointmentId)
    .maybeSingle();
  const notFound = NextResponse.json({ error: "That appointment no longer exists. Refresh the calendar.", code: "appointment_not_found" }, { status: 404 });
  if (error) return notFound;
  if (!data) return null;
  return appointmentVisible(scope, { agentUserId: data.agent_user_id, bookedBy: data.booked_by }, context.userId) ? null : notFound;
}

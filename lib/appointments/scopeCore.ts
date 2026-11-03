import { rowVisible, type ProducerScope } from "../agency/visibilityCore";

/**
 * AG-0.5 · which appointments a session may see (no database, no next/server: the services import it;
 * the route-side guard is ./scope.ts). An appointment belongs to the agent whose calendar it is on (D1:
 * tenant_appointments.agent_user_id). In an agency a narrow session sees the appointments on the
 * calendars of the producers in its scope, plus the ones it booked itself (a setter's own bookings: he
 * made them, and LA-2.12 measures him on them). Null scope (individual plan, owner/admin): all of them,
 * exactly as before.
 */
export function appointmentVisible(scope: ProducerScope, row: { agentUserId: string | null; bookedBy: string | null }, viewerId: string): boolean {
  if (scope === null) return true;
  if (viewerId && (row.agentUserId === viewerId || row.bookedBy === viewerId)) return true;
  return rowVisible(scope, row.agentUserId);
}

/** A calendar holder the session may see: itself or a producer in its scope. */
export function calendarVisible(scope: ProducerScope, userId: string | null | undefined, viewerId: string): boolean {
  return scope === null || (Boolean(viewerId) && userId === viewerId) || rowVisible(scope, userId);
}

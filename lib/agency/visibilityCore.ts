/**
 * AG-0.4 (Notion sprint, Agency Module 0) · the producer-visibility rule, with no database.
 *
 * The same rule as the SQL function agency_visible_user_ids (migration 20261018130000). The application
 * helper (visibility.ts) asks the database rather than this, so the two can never disagree; this copy exists
 * so the rule itself is unit-tested and readable in one place.
 *
 *   individual plan                          → null (no filter — solo agents pay nothing)
 *   owner | admin | bookkeeper | retention    → null (the whole agency)
 *   manager                                  → self + direct reports, as of today
 *   producer | anything unnamed            → [self]
 *   setter                                   → [self] + the producers he books for (20261019100000)
 *   assistant                                → the producer(s) he assists ([] when none: absent, not guessed)
 */

/** null = no filter. A list = exactly these producer user ids (possibly empty). */
export type ProducerScope = readonly string[] | null;

export function visibleUserIdsFor(input: {
  audience: "individual" | "agency" | null;
  role: string | null; // the BASE role on tenant_users; null = not a member
  title: "admin" | "manager" | null;
  selfUserId: string;
  directReportUserIds?: readonly string[];
  assistsUserIds?: readonly string[];
}): ProducerScope {
  if (input.audience !== "agency") return null;
  if (!input.role) return [];
  if (input.role === "owner" || input.role === "bookkeeper" || input.role === "retention") return null;
  if (input.role === "assistant") return [...(input.assistsUserIds ?? [])].sort();
  // A setter books onto his producers' calendars (owner decision 2026-10-19), and keeps his own dials and bookings.
  if (input.role === "setter") return [input.selfUserId, ...[...(input.assistsUserIds ?? [])].sort()];
  if (input.title === "manager") return [input.selfUserId, ...[...(input.directReportUserIds ?? [])].sort()];
  return [input.selfUserId];
}

/** Whether a row attributed to `producerUserId` is visible under a scope. An unattributed row is visible only to "all". */
export function rowVisible(scope: ProducerScope, producerUserId: string | null | undefined): boolean {
  if (scope === null) return true;
  return Boolean(producerUserId) && scope.includes(producerUserId as string);
}

/** Filters already-read rows by their producer column — for aggregates computed in code, which count too. */
export function keepVisible<T>(scope: ProducerScope, rows: readonly T[], producerOf: (row: T) => string | null | undefined): T[] {
  return scope === null ? [...rows] : rows.filter((row) => rowVisible(scope, producerOf(row)));
}

/** A sentinel that matches no user id, for `.in(column, …)` when the scope is empty (an empty IN is invalid). */
export const NO_PRODUCER = "00000000-0000-0000-0000-000000000000";

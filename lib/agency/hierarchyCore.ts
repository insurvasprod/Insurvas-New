/**
 * AG-0.3 (Notion sprint, Agency Module 0) · who reported to whom ON A DATE, with no database.
 *
 * Reports are computed as of the date they are about, never "today": a producer who moved in June must
 * not change May's report. One level deep only — the recursive descendants query is deliberately not
 * built (two-level hierarchy; three levels is a project with a roll-up toggle on every report).
 */

export type HierarchyRow = {
  producerId: string;
  /** null = reports to the owner */
  parentProducerId: string | null;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // inclusive; null = open
};

const inForce = (row: HierarchyRow, asOf: string) => row.effectiveFrom <= asOf && (row.effectiveTo === null || asOf <= row.effectiveTo);

/** The manager a producer reported to on `asOf`: a producer id, null for the owner, undefined when no row covers the date. */
export function managerAsOf(rows: readonly HierarchyRow[], producerId: string, asOf: string): string | null | undefined {
  const row = rows.find((r) => r.producerId === producerId && inForce(r, asOf));
  return row ? row.parentProducerId : undefined;
}

/** Direct reports of a manager on `asOf` — one level, as the database's producer_direct_reports. */
export function directReportsAsOf(rows: readonly HierarchyRow[], managerProducerId: string, asOf: string): string[] {
  return rows.filter((r) => r.parentProducerId === managerProducerId && inForce(r, asOf)).map((r) => r.producerId).sort();
}

/** The day before a date, for closing a row (`effective_to = move date − 1`). */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Whether moving `producerId` under `newParent` on `asOf` would make a cycle (him, or anyone above the new parent, is him). */
export function wouldCycle(rows: readonly HierarchyRow[], producerId: string, newParent: string | null, asOf: string): boolean {
  let walk: string | null | undefined = newParent;
  for (let depth = 0; walk && depth < 64; depth += 1) {
    if (walk === producerId) return true;
    walk = managerAsOf(rows, walk, asOf);
  }
  return false;
}

/** The rows after a move: the row in force is closed the day before, a new open row starts. Never an edit of a parent. */
export function applyMove(rows: readonly HierarchyRow[], producerId: string, newParent: string | null, effectiveFrom: string): HierarchyRow[] {
  if (wouldCycle(rows, producerId, newParent, effectiveFrom)) throw new Error("hierarchy_cycle");
  const next = rows.map((row) =>
    row.producerId === producerId && inForce(row, effectiveFrom) ? { ...row, effectiveTo: dayBefore(effectiveFrom) } : row,
  );
  next.push({ producerId, parentProducerId: newParent, effectiveFrom, effectiveTo: null });
  return next;
}

// The plan editor's save (admin_save_plan_version_complete): its refusals and its audit diff.
// Plain module so the tests run it under `node --experimental-strip-types`.

/** One meter as the plan editor shows it: the plan's own row, or the platform default it falls back to. */
export type PlanEditorMeter = {
  meter_key: string;
  label: string;
  unit: string;
  default_hard_cap: boolean;
  /** meter_pricing.default_included: what a plan without its own row gets. Null = unlimited. */
  platform_default: number | null;
  /** The plan's own row; null when the plan takes the platform default. */
  plan: { included_qty: number | null; hard_cap: boolean } | null;
};

export type PlanMeterInput = { meter_key: string; included_qty: number | null; hard_cap: boolean };
export type MeterChange = { from: Omit<PlanMeterInput, "meter_key"> | null; to: Omit<PlanMeterInput, "meter_key"> | null };

export function planSaveErrorResponse(error: { message?: string | null; code?: string | null }): { status: number; error: string } {
  const message = error.message ?? "";
  if (message.includes("no_features")) return { status: 400, error: "A plan must grant at least one feature" };
  if (message.includes("plan_not_found")) return { status: 404, error: "Plan not found" };
  if (message.includes("unknown_plan_limit") || message.includes("invalid_plan_limit")) return { status: 400, error: "One of the limits is not a whole number of 0 or more" };
  if (message.includes("invalid_plan_meter")) return { status: 400, error: "One of the allowances is not a whole number of 0 or more" };
  if (message.includes("duplicate_plan_meter")) return { status: 400, error: "A meter is listed twice" };
  if (error.code === "23503") return { status: 400, error: "One of those features or meters doesn't exist" };
  return { status: 500, error: "Could not save the plan" };
}

/** What changed in the plan's own meter rows. A row removed means "back to the platform default". */
export function diffPlanMeters(before: readonly PlanMeterInput[], after: readonly PlanMeterInput[]): Record<string, MeterChange> {
  const byKey = (rows: readonly PlanMeterInput[]) => new Map(rows.map((row) => [row.meter_key, { included_qty: row.included_qty, hard_cap: row.hard_cap }]));
  const was = byKey(before);
  const now = byKey(after);
  const changes: Record<string, MeterChange> = {};
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const from = was.get(key) ?? null;
    const to = now.get(key) ?? null;
    if (from?.included_qty !== to?.included_qty || from?.hard_cap !== to?.hard_cap) changes[key] = { from, to };
  }
  return changes;
}

/** The version a publish will create: one past the highest version of the code, not of this row. */
export function nextPlanVersion(versionsOfCode: readonly number[], current: number): number {
  return Math.max(current, ...versionsOfCode) + 1;
}

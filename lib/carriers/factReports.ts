import "server-only";

import { z } from "zod";

import { HTTPS_ORIGIN, patternProblem, toHttpsOrigin } from "@/lib/salesSettings/carrierSchemas";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

import {
  FACT_REPORT_KEYS, FACT_REPORTS_PENDING_MESSAGE, isFixable,
  type FactReportKey, type FactReportQueueRow, type FactReportStatus, type FactReportView, type FixableFactKey,
} from "./factReportConstants";
import { isPendingSchema } from "./schemaGap";

/**
 * Carrier fact reports (migration 20261027200000, owner 2026-10-27). An agency reports a wrong
 * carrier fact from Settings › Carriers; Insurvas staff fix the platform value once for every agency
 * (portal address, policy number format, bank statement text) or fix the product catalog and close
 * the report by hand. Every read and write goes through the service role, so every query filters by
 * tenant or by the report's id.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- carrier_fact_reports is not in database.types.ts until the migration is applied and the types regenerated
const db = () => getSupabaseServiceClient() as any;

export class FactReportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "FactReportError";
  }
}

function fail(error: { message: string; code?: string } | null, what: string): never {
  if (error && isPendingSchema(error)) throw new FactReportError(FACT_REPORTS_PENDING_MESSAGE, 503);
  console.error(`[carrier-fact-reports] ${what}`, error);
  throw new FactReportError(`${what} failed. Try again.`, 500);
}

const COLUMNS = "id, tenant_id, carrier_id, fact_key, shown_value, suggested_value, evidence, status, reported_by, created_at, resolved_at, resolution_note";
type Row = {
  id: string; tenant_id: string; carrier_id: string; fact_key: FactReportKey; shown_value: string | null; suggested_value: string; evidence: string | null;
  status: FactReportStatus; reported_by: string | null; created_at: string; resolved_at: string | null; resolution_note: string | null;
};

const view = (row: Row, carrierName: string): FactReportView => ({
  id: row.id, carrierId: row.carrier_id, carrierName, factKey: row.fact_key, shownValue: row.shown_value, suggestedValue: row.suggested_value,
  evidence: row.evidence, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at, resolutionNote: row.resolution_note,
});

async function namesOf(table: "carriers" | "tenants" | "users", ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await db().from(table).select("id, name").in("id", [...new Set(ids)]);
  if (error) fail(error, `Reading ${table}`);
  return new Map(((data ?? []) as { id: string; name: string | null }[]).map((row) => [row.id, row.name ?? ""]));
}

/* ── the agency side ───────────────────────────────────────────────────────────────────────── */

export const createFactReportSchema = z.object({
  carrier_id: z.string().uuid("Choose a carrier"),
  fact_key: z.enum(FACT_REPORT_KEYS, { message: "Choose which fact is wrong" }),
  shown_value: z.string().trim().max(1000).nullable().default(null),
  suggested_value: z.string().trim().min(1, "Say what it should be").max(500, "Keep it under 500 characters"),
  evidence: z.string().trim().max(500, "Keep it under 500 characters").nullable().default(null),
}).strict();

export async function createFactReport(tenantId: string, userId: string, input: z.infer<typeof createFactReportSchema>): Promise<FactReportView> {
  const carrier = await db().from("carriers").select("id, name").eq("id", input.carrier_id).is("organization_id", null).maybeSingle();
  if (carrier.error) fail(carrier.error, "Reading the carrier");
  if (!carrier.data) throw new FactReportError("That carrier is not in the Insurvas library.", 404);
  // The same fact reported again while the first is still open adds nothing for staff: say so.
  const open = await db().from("carrier_fact_reports").select("id").eq("tenant_id", tenantId).eq("carrier_id", input.carrier_id).eq("fact_key", input.fact_key).eq("status", "open").limit(1);
  if (open.error) fail(open.error, "Reading your reports");
  if ((open.data ?? []).length) throw new FactReportError("You already reported this fact. Insurvas is checking it.", 409);
  const { data, error } = await db().from("carrier_fact_reports").insert({
    tenant_id: tenantId, carrier_id: input.carrier_id, fact_key: input.fact_key, shown_value: input.shown_value || null,
    suggested_value: input.suggested_value, evidence: input.evidence || null, reported_by: userId,
  }).select(COLUMNS).single();
  if (error) fail(error, "Saving the report");
  return view(data as Row, (carrier.data as { name: string }).name);
}

/** The agency's own reports, newest first: open ones show on the carrier card, closed ones say how they ended. */
export async function listTenantFactReports(tenantId: string): Promise<{ reports: FactReportView[]; available: boolean }> {
  const { data, error } = await db().from("carrier_fact_reports").select(COLUMNS).eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200);
  if (error) {
    if (isPendingSchema(error)) return { reports: [], available: false };
    fail(error, "Reading your reports");
  }
  const rows = (data ?? []) as Row[];
  const carriers = await namesOf("carriers", rows.map((row) => row.carrier_id));
  return { reports: rows.map((row) => view(row, carriers.get(row.carrier_id) ?? "")), available: true };
}

/* ── the staff side ────────────────────────────────────────────────────────────────────────── */

const FACT_COLUMN: Record<FixableFactKey, "portal_origin" | "reference_pattern" | "billing_descriptor"> = {
  portal_origin: "portal_origin", reference_pattern: "reference_pattern", billing_descriptor: "billing_descriptor",
};

/** Open reports first (oldest first), then the last 100 closed. */
export async function listFactReportQueue(): Promise<{ reports: FactReportQueueRow[]; available: boolean }> {
  const [open, closed] = await Promise.all([
    db().from("carrier_fact_reports").select(COLUMNS).eq("status", "open").order("created_at", { ascending: true }).limit(500),
    db().from("carrier_fact_reports").select(COLUMNS).neq("status", "open").order("resolved_at", { ascending: false }).limit(100),
  ]);
  for (const read of [open, closed]) {
    if (read.error) {
      if (isPendingSchema(read.error)) return { reports: [], available: false };
      fail(read.error, "Reading the report queue");
    }
  }
  const rows = [...(open.data ?? []), ...(closed.data ?? [])] as Row[];
  const carrierIds = [...new Set(rows.map((row) => row.carrier_id))];
  const [tenants, users, facts] = await Promise.all([
    namesOf("tenants", rows.map((row) => row.tenant_id)),
    namesOf("users", rows.map((row) => row.reported_by).filter((id): id is string => Boolean(id))),
    carrierIds.length
      ? db().from("carriers").select("id, name, portal_origin, reference_pattern, billing_descriptor").in("id", carrierIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (facts.error) fail(facts.error, "Reading the carriers");
  const carriers = new Map(((facts.data ?? []) as ({ id: string; name: string } & Record<"portal_origin" | "reference_pattern" | "billing_descriptor", string | null>)[]).map((row) => [row.id, row]));
  return {
    available: true,
    reports: rows.map((row) => {
      const carrier = carriers.get(row.carrier_id);
      return {
        ...view(row, carrier?.name ?? ""),
        tenantId: row.tenant_id,
        tenantName: tenants.get(row.tenant_id) ?? "",
        reportedBy: row.reported_by ? users.get(row.reported_by) ?? null : null,
        currentValue: isFixable(row.fact_key) && carrier ? carrier[FACT_COLUMN[row.fact_key]] : null,
      };
    }),
  };
}

export const resolveFactReportSchema = z.object({
  status: z.enum(["fixed", "declined"]),
  /** Fixed, on a portal address, policy number format or bank statement fact: the new platform value. */
  value: z.string().trim().max(500).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

/** The platform value as the carriers table stores it, or the reason it cannot be. */
function platformValue(key: FixableFactKey, raw: string): { value: string } | { problem: string } {
  if (key === "portal_origin") {
    const origin = toHttpsOrigin(raw);
    return origin && HTTPS_ORIGIN.test(origin) ? { value: origin } : { problem: "Use the portal's https address, like https://agents.carrier.com." };
  }
  if (key === "reference_pattern") {
    const problem = raw.length > 200 ? "A pattern is at most 200 characters." : patternProblem(raw);
    return problem ? { problem } : { value: raw };
  }
  const descriptor = raw.toUpperCase();
  return descriptor.length > 60 ? { problem: "A bank statement descriptor is at most 60 characters." } : { value: descriptor };
}

/**
 * Close one open report. Fixed with a value writes it to the platform carrier first, so every agency
 * reads it (an agency's own older value, if any, still wins for that agency until it matches).
 */
export async function resolveFactReport(adminId: string, id: string, input: z.infer<typeof resolveFactReportSchema>): Promise<{ report: FactReportView; changed: { column: string; before: string | null; after: string } | null }> {
  const current = await db().from("carrier_fact_reports").select(COLUMNS).eq("id", id).maybeSingle();
  if (current.error) fail(current.error, "Reading the report");
  const row = current.data as Row | null;
  if (!row) throw new FactReportError("Report not found.", 404);
  if (row.status !== "open") throw new FactReportError("This report is already closed.", 409);
  if (input.status === "declined" && !input.note?.trim()) throw new FactReportError("Say why, so the agency knows.", 400);

  let changed: { column: string; before: string | null; after: string } | null = null;
  if (input.status === "fixed" && input.value?.trim()) {
    if (!isFixable(row.fact_key)) throw new FactReportError("Fix this one on the product catalog, then mark it fixed without a value.", 400);
    const next = platformValue(row.fact_key, input.value.trim());
    if ("problem" in next) throw new FactReportError(next.problem, 400);
    const column = FACT_COLUMN[row.fact_key];
    const before = await db().from("carriers").select(`id, ${column}`).eq("id", row.carrier_id).is("organization_id", null).maybeSingle();
    if (before.error) fail(before.error, "Reading the carrier");
    if (!before.data) throw new FactReportError("The carrier is no longer in the library.", 404);
    const update = await db().from("carriers").update({ [column]: next.value }).eq("id", row.carrier_id).is("organization_id", null);
    if (update.error) fail(update.error, "Saving the carrier");
    changed = { column, before: (before.data as Record<string, string | null>)[column] ?? null, after: next.value };
  }

  const { data, error } = await db().from("carrier_fact_reports")
    .update({ status: input.status, resolved_at: new Date().toISOString(), resolved_by: adminId, resolution_note: input.note?.trim() || null })
    .eq("id", id).eq("status", "open").select(COLUMNS).maybeSingle();
  if (error) fail(error, "Closing the report");
  if (!data) throw new FactReportError("Someone else closed this report first.", 409);
  const names = await namesOf("carriers", [row.carrier_id]);
  return { report: view(data as Row, names.get(row.carrier_id) ?? ""), changed };
}

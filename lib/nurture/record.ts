import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { NurtureOrigin, RecycleContext } from "./contract";

/**
 * The recycling facts the lead's Nurture tab adds to the record (lib/leadWorkspace/record.ts):
 * the dial ceiling of the pass the lead is on, the batch's angle and script, the angle of each
 * earlier reactivation, and why the lead is in nurture at all — recycled, rested by an outcome, or
 * an inbound transfer nobody claimed. Every read tolerates 20260925706500 not being applied yet and
 * then answers as the product did before it: no ceiling of its own, no angle.
 */
export type RecycleFacts = {
  attemptCeiling: number | null;
  context: RecycleContext | null;
  origin: NurtureOrigin;
  /** In nurture with a due date still ahead (read when the record was loaded). */
  resting: boolean;
  anglesByReactivation: Record<string, string>;
};

type Result = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
type Chain = Result & { eq(column: string, value: unknown): Chain; in(column: string, values: string[]): Chain; not(column: string, operator: string, value: unknown): Chain; limit(count: number): Chain; maybeSingle(): Result };
type Loose = { from(table: string): { select(columns: string): Chain }; rpc(name: string, args: Record<string, unknown>): Result };

const settle = (query: Result) => Promise.resolve(query).then((result) => result, () => ({ data: null, error: { message: "failed" } }));

export async function loadRecycleFacts(tenantId: string, leadId: string, lead: { leadState: string | null; nextDialAfter: string | null }): Promise<RecycleFacts> {
  const db = getSupabaseServiceClient() as unknown as Loose;
  const [ceiling, context, reactivations, fromTransfer] = await Promise.all([
    settle(db.from("agent_leads").select("attempt_ceiling").eq("tenant_id", tenantId).eq("id", leadId).maybeSingle()),
    settle(db.rpc("lead_recycle_context", { p_tenant_id: tenantId, p_lead_id: leadId })),
    settle(db.from("tenant_nurture_reactivations").select("id, batch_id").eq("tenant_id", tenantId).eq("lead_id", leadId)),
    settle(db.from("lead_queue").select("id").eq("tenant_id", tenantId).eq("lead_id", leadId).in("status", ["unclaimed", "claimed"]).not("nurtured_from_work_item_id", "is", null).limit(1)),
  ]);

  const ceilingValue = ceiling.error ? null : Number((ceiling.data as { attempt_ceiling?: number | null } | null)?.attempt_ceiling ?? NaN);
  const raw = context.error ? null : (context.data as Record<string, unknown> | null);
  const recycle: RecycleContext | null = raw && typeof raw === "object" && typeof raw.angle === "string"
    ? { batchId: String(raw.batch_id), angle: raw.angle, script: typeof raw.script === "string" && raw.script ? raw.script : null, attemptCeiling: Number(raw.attempt_ceiling ?? 3), recycleNumber: Number(raw.recycle_number ?? 0), recycledAt: typeof raw.recycled_at === "string" ? raw.recycled_at : null, current: raw.current === true }
    : null;

  const anglesByReactivation: Record<string, string> = {};
  const rows = reactivations.error ? [] : ((reactivations.data ?? []) as Array<{ id: string; batch_id: string | null }>);
  const batchIds = [...new Set(rows.map((row) => row.batch_id).filter((id): id is string => Boolean(id)))];
  if (batchIds.length) {
    const batches = await settle(db.from("tenant_recycle_batches").select("id, angle").eq("tenant_id", tenantId).in("id", batchIds));
    const angleOf = new Map(((batches.error ? [] : batches.data ?? []) as Array<{ id: string; angle: string }>).map((row) => [row.id, row.angle]));
    for (const row of rows) if (row.batch_id && angleOf.has(row.batch_id)) anglesByReactivation[row.id] = angleOf.get(row.batch_id) as string;
  }

  let origin: NurtureOrigin = null;
  if (lead.leadState === "nurture") {
    const expired = !fromTransfer.error && ((fromTransfer.data ?? []) as unknown[]).length > 0;
    origin = recycle?.current ? "recycled" : expired ? "expired_transfer" : "rested";
  } else if (lead.leadState === "exhausted") {
    origin = "cadence";
  }

  const resting = lead.leadState === "nurture" && lead.nextDialAfter != null && Date.parse(lead.nextDialAfter) > Date.now();
  return { attemptCeiling: Number.isInteger(ceilingValue) && (ceilingValue as number) > 0 ? ceilingValue : null, context: recycle, origin, resting, anglesByReactivation };
}

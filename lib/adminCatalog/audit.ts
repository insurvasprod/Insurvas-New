import "server-only";

import type { AdminRole } from "@/lib/adminAuth/roles";
import { catalogStepsFor, type CatalogStep } from "@/lib/adminCatalog/steps";
import { AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Viewer = { id: string; role: AdminRole };

// audit_log is read loosely (not every column is in the generated types).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

/** Which Catalog step each audit action family belongs to. "carrier.fact_report" goes to Fact reports. */
const STEP_OF_PREFIX: ReadonlyArray<[string, CatalogStep]> = [
  ["plan.", "plans"],
  ["addon.", "addons"],
  ["feature.", "features"],
  ["product.", "products"],
  ["template.", "templates"],
  ["carrier.fact_report", "reports"],
  ["carrier.", "carriers"],
  ["carrier_rule.", "rules"],
  ["carrier_settings.", "rules"],
  ["layout_map.", "layouts"],
  ["layout_assignment.", "layouts"],
  ["status_map.", "status"],
  ["field_map.", "fields"],
  ["carrier_guidance.", "guidance"],
  ["carrier_servicing_guide.", "servicing"],
];

export function catalogStepOfAction(action: string): CatalogStep | null {
  return STEP_OF_PREFIX.find(([prefix]) => action.startsWith(prefix))?.[1] ?? null;
}

export type CatalogAuditItem = {
  id: string;
  at: string;
  action: string;
  /** The action in words ("Plan version published"). */
  label: string;
  /** Who: an admin's name, "System", "An agency"; null when unknown. */
  by: string | null;
  reason: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Catalog changes from the audit log, newest first. The audit log keeps its own rule (lib/audit/logQuery.ts): only a
 * super admin reads other staff members' actions; anyone else sees their own, plus what agencies and the system did.
 *
 * `prefixes` limits the action families (the workspace passes the ones the role's steps cover); `target` limits it to
 * rows about one record (a plan's versions, an add-on, a feature by id or key). Throws on a failed read.
 */
export async function readCatalogAudit(viewer: Viewer, filter: { prefixes?: readonly string[]; target?: { type: string; ids: readonly string[] } }, limit = 40): Promise<CatalogAuditItem[]> {
  let query = db().from("audit_log").select("id, ts, actor_type, actor_id, action, reason, target_type, target_id, metadata").order("ts", { ascending: false }).limit(limit);
  if (filter.prefixes) {
    if (filter.prefixes.length === 0) return [];
    query = query.or(filter.prefixes.map((prefix) => `action.like.${prefix}*`).join(","));
  }
  if (filter.target) {
    const ids = filter.target.ids.filter((id) => /^[\w.-]+$/.test(id));
    if (ids.length === 0) return [];
    query = query.eq("target_type", filter.target.type).in("target_id", ids);
  }
  if (viewer.role !== "super_admin") query = query.or(`actor_type.neq.admin,actor_id.eq.${viewer.id}`);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read the audit log: ${error.message}`);

  type Row = { id: string | number; ts: string; actor_type: string; actor_id: string | null; action: string; reason: string | null; target_type: string | null; target_id: string | null; metadata: Record<string, unknown> | null };
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.filter((row) => row.actor_type === "admin" && row.actor_id).map((row) => row.actor_id as string))];
  const admins = ids.length ? await db().from("admin_users").select("id, name").in("id", ids) : { data: [] };
  const names = new Map(((admins.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  return rows.map((row) => ({
    id: String(row.id),
    at: row.ts,
    action: row.action,
    label: (AUDIT_ACTION_LABELS as Record<string, string>)[row.action as AuditAction] ?? row.action,
    by: row.actor_type === "admin" ? (row.actor_id ? names.get(row.actor_id) ?? "An admin" : "An admin") : row.actor_type === "system" ? "System" : row.actor_type === "tenant" ? "An agency" : null,
    reason: row.reason,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: row.metadata,
  }));
}

/** The action families of the steps this role may open, for "Recent changes". */
export function catalogPrefixesFor(role: AdminRole): string[] {
  const steps = new Set<string>(catalogStepsFor(role).map((step) => step.key));
  return STEP_OF_PREFIX.filter(([, step]) => steps.has(step)).map(([prefix]) => prefix);
}

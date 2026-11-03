import "server-only";

import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";
import { AUDIT_LOG_PAGE_SIZE } from "@/lib/audit/constants";
import { isMoneyAction } from "@/lib/audit/moneyActions";
import {
  formatUtc,
  isApproximateCount,
  isUuid,
  quotePostgrestValue,
  searchMatchingActions,
  utcDayBounds,
  type AuditActorType,
  type AuditLogEntry,
  type AuditLogFilters,
} from "@/lib/audit/logView";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * /admin/audit-log's reads, shared by the page (first render) and GET /api/admin/audit-log (every
 * page and filter after it), so the two cannot apply the per-actor rule or the filters differently.
 *
 * The per-actor rule (user decision, doc §2.5): only a super admin sees every actor's actions.
 * Anyone else is locked to their own rows, whatever they pass — a server-side floor, not a UI
 * default — and the tiles count the same rows the table would show.
 */

export type AuditViewer = { id: string; role: AdminRole };
export type StaffMember = { id: string; name: string; email: string };

export type AuditLogPage = {
  entries: AuditLogEntry[];
  total: number;
  approximate: boolean;
  /** When the rows were read (ms), so "4 minutes ago" agrees on the server and in the browser. */
  readAt: number;
};

export type AuditSummary = {
  todayCount: number;
  /** Distinct staff members who acted today; null when it could not be counted exactly. */
  todayAdmins: number | null;
  /** True when todayAdmins is a lower bound (the fallback read hit its cap). */
  todayAdminsAtLeast: boolean;
  weekCount: number;
  moneyCount: number;
};

const COLUMNS = "id, ts, actor_type, actor_id, action, target_type, target_id, reason, ip, user_agent, metadata";

type RawRow = {
  id: string;
  ts: string;
  actor_type: AuditActorType;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: unknown;
};

// Past this many matching actions the search sends a pattern instead of a list: a word like
// "tenant" matches about 170 codes, and that list would ride in the request URL.
const MAX_ACTION_LIST = 50;
const CODE_SHAPED = /^[a-z0-9_.]+$/i;

export function isSuperAdmin(viewer: AuditViewer): boolean {
  return viewer.role === "super_admin";
}

/** Every staff member, for the actor dropdown and the Actor column. Super admins only. */
export async function listStaff(viewer: AuditViewer): Promise<StaffMember[]> {
  if (!isSuperAdmin(viewer)) return [];
  const { data } = await getSupabaseServiceClient().from("admin_users").select("id, name, email").order("name");
  return (data ?? []) as StaffMember[];
}

export async function fetchAuditLogPage(
  viewer: AuditViewer,
  filters: AuditLogFilters,
  staff: StaffMember[] | null = null,
): Promise<AuditLogPage> {
  const supabase = getSupabaseServiceClient();

  // "estimated", not "exact": an exact count is a full scan of a table past 45,000 rows on every
  // request. PostgREST still counts exactly below its max-rows threshold and switches to the
  // planner's estimate beyond it; the footer then says "about".
  let query = supabase.from("audit_log").select(COLUMNS, { count: "estimated" }).order("ts", { ascending: false });

  if (isSuperAdmin(viewer)) {
    if (filters.actorId) query = query.eq("actor_id", filters.actorId);
    else if (filters.actorType) query = query.eq("actor_type", filters.actorType);
  } else {
    query = query.eq("actor_id", viewer.id);
  }

  if (filters.action) query = query.eq("action", filters.action);
  // Exact match, not a pattern: a target_id is an opaque identifier copied from a detail page.
  if (filters.target) query = query.eq("target_id", filters.target);

  const bounds = utcDayBounds(filters.from, filters.to);
  if (bounds.gte) query = query.gte("ts", bounds.gte);
  if (bounds.lt) query = query.lt("ts", bounds.lt);

  if (filters.q) {
    const matches = searchMatchingActions(filters.q, AUDIT_ACTIONS, AUDIT_ACTION_LABELS);
    const target = `target_id.eq.${quotePostgrestValue(filters.q)}`;
    if (matches.length > 0 && matches.length <= MAX_ACTION_LIST) {
      query = query.or(`action.in.(${matches.join(",")}),${target}`);
    } else if (matches.length > MAX_ACTION_LIST && CODE_SHAPED.test(filters.q)) {
      query = query.or(`action.ilike.${quotePostgrestValue(`*${filters.q}*`)},${target}`);
    } else {
      query = query.eq("target_id", filters.q);
    }
  }

  const from = (filters.page - 1) * AUDIT_LOG_PAGE_SIZE;
  // The actor lookup does not wait for the rows: a super admin may see any staff member (a small
  // table, usually passed in by the page); anyone else only ever sees their own rows.
  const [{ data, count, error }, staffList] = await Promise.all([
    query.range(from, from + AUDIT_LOG_PAGE_SIZE - 1),
    isSuperAdmin(viewer) ? (staff ? Promise.resolve(staff) : listStaff(viewer)) : selfOnly(viewer),
  ]);

  // The audit log is the evidence of record. "No recorded actions" and "we could not read the
  // record" are very different sentences, and the second one must never be shown as the first.
  if (error) throw new Error(`Could not load the audit log: ${error.message}`);

  const entries = await describe((data ?? []) as unknown as RawRow[], staffList);
  const total = count ?? 0;
  return { entries, total, approximate: isApproximateCount(total), readAt: Date.now() };
}

async function selfOnly(viewer: AuditViewer): Promise<StaffMember[]> {
  const { data } = await getSupabaseServiceClient().from("admin_users").select("id, name, email").eq("id", viewer.id);
  return (data ?? []) as StaffMember[];
}

// ── labels ─────────────────────────────────────────────────────────────────────────────────────

type Lookup = { table: string; columns: string; label: (row: Record<string, unknown>) => string | null };

// Target types whose uuid can be turned into something a person recognises. Anything else keeps
// its raw `type:id`, which is still exact.
const TARGET_LOOKUPS: Record<string, Lookup> = {
  tenant: { table: "tenants", columns: "id, name", label: (r) => str(r.name) },
  user: { table: "users", columns: "id, email", label: (r) => str(r.email) },
  admin_user: { table: "admin_users", columns: "id, email", label: (r) => str(r.email) },
  invoice: { table: "platform_invoices", columns: "id, number", label: (r) => str(r.number) },
  credit_note: { table: "credit_notes", columns: "id, number", label: (r) => str(r.number) },
  plan: { table: "plans", columns: "id, code, version", label: (r) => (str(r.code) ? `${str(r.code)} v${r.version}` : null) },
  feature: { table: "features", columns: "id, feature_key", label: (r) => str(r.feature_key) },
  carrier: { table: "carriers", columns: "id, name", label: (r) => str(r.name) },
  product: { table: "products", columns: "id, name", label: (r) => str(r.name) },
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

type LooseClient = {
  from(table: string): {
    select(columns: string): { in(column: string, values: string[]): PromiseLike<{ data: unknown; error: unknown }> };
  };
};

/** id → label for one table. A failed lookup is not an error: the cell falls back to the raw id. */
async function lookup(table: string, columns: string, ids: string[], label: Lookup["label"]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const client = getSupabaseServiceClient() as unknown as LooseClient;
  const { data, error } = await client.from(table).select(columns).in("id", ids);
  if (error || !Array.isArray(data)) return out;
  for (const row of data as Record<string, unknown>[]) {
    const text = label(row);
    if (typeof row.id === "string" && text) out.set(row.id, text);
  }
  return out;
}

function uniqueUuids(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && isUuid(v)))];
}

async function describe(rows: RawRow[], staff: StaffMember[]): Promise<AuditLogEntry[]> {
  const staffById = new Map(staff.map((s) => [s.id, s]));

  // Agency and partner users act as actor_type 'tenant'; their id is a users row.
  const tenantActorIds = uniqueUuids(rows.filter((r) => r.actor_type === "tenant").map((r) => r.actor_id));

  const targetsByType = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.target_type || !TARGET_LOOKUPS[row.target_type] || !row.target_id || !isUuid(row.target_id)) continue;
    const list = targetsByType.get(row.target_type) ?? [];
    if (!list.includes(row.target_id)) list.push(row.target_id);
    targetsByType.set(row.target_type, list);
  }

  const [tenantActors, ...targetMaps] = await Promise.all([
    lookupPeople(tenantActorIds),
    ...[...targetsByType].map(async ([type, ids]) => {
      const spec = TARGET_LOOKUPS[type];
      return [type, await lookup(spec.table, spec.columns, ids, spec.label)] as const;
    }),
  ]);
  const targetLabels = new Map(targetMaps);

  return rows.map((row) => {
    const actor = describeActor(row, staffById, tenantActors);
    return {
      id: row.id,
      ts: row.ts,
      whenUtc: formatUtc(row.ts),
      actor_type: row.actor_type,
      actor_id: row.actor_id,
      actorLabel: actor.label,
      actorDetail: actor.detail,
      action: row.action,
      actionLabel: AUDIT_ACTION_LABELS[row.action as AuditAction] ?? null,
      target_type: row.target_type,
      target_id: row.target_id,
      targetLabel: (row.target_type && row.target_id && targetLabels.get(row.target_type)?.get(row.target_id)) || null,
      reason: row.reason,
      ip: row.ip,
      user_agent: row.user_agent,
      metadata: row.metadata,
    };
  });
}

async function lookupPeople(ids: string[]): Promise<Map<string, { name: string | null; email: string }>> {
  const out = new Map<string, { name: string | null; email: string }>();
  if (ids.length === 0) return out;
  const client = getSupabaseServiceClient() as unknown as LooseClient;
  const { data, error } = await client.from("users").select("id, name, email").in("id", ids);
  if (error || !Array.isArray(data)) return out;
  for (const row of data as Record<string, unknown>[]) {
    const email = str(row.email);
    if (typeof row.id === "string" && email) out.set(row.id, { name: str(row.name), email });
  }
  return out;
}

function describeActor(
  row: RawRow,
  staffById: Map<string, StaffMember>,
  tenantActors: Map<string, { name: string | null; email: string }>,
): { label: string; detail: string | null } {
  if (row.actor_type === "system") return { label: "System", detail: "Scheduled job or provider event" };
  if (row.actor_type === "tenant") {
    const person = row.actor_id ? tenantActors.get(row.actor_id) : undefined;
    if (person) return { label: person.email, detail: person.name ? `${person.name} (${person.email}), agency user` : `${person.email}, agency user` };
    return { label: "Agency user", detail: row.actor_id ? `Agency user ${row.actor_id}, not found` : "Agency user, not recorded" };
  }
  const member = row.actor_id ? staffById.get(row.actor_id) : undefined;
  if (member) return { label: member.email, detail: `${member.name} (${member.email})` };
  return { label: "Staff member", detail: row.actor_id ? `Staff member ${row.actor_id}, no longer on the admin list` : "Staff member, not recorded" };
}

// ── tiles ──────────────────────────────────────────────────────────────────────────────────────

const MISSING_FUNCTION = new Set(["42883", "PGRST202"]);
// The fallback counts today's distinct staff by reading their ids; staff write a few dozen rows a
// day, so this cap is far above a real day and only exists to bound the read.
const FALLBACK_ADMIN_ROW_CAP = 2000;

function startOfUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * The four figures above the table. Throws only when nothing at all could be read; the page shows
 * the tiles as unavailable in that case rather than as zeros.
 */
export async function fetchAuditSummary(viewer: AuditViewer): Promise<AuditSummary> {
  const supabase = getSupabaseServiceClient();
  const actorId = isSuperAdmin(viewer) ? null : viewer.id;
  const moneyActions = AUDIT_ACTIONS.filter(isMoneyAction);

  const rpc = await supabase.rpc("admin_audit_summary" as never, { p_actor_id: actorId, p_money_actions: moneyActions } as never);
  if (!rpc.error) {
    const row = ((rpc.data ?? []) as unknown as Record<string, number | string | null>[])[0];
    if (row) {
      return {
        todayCount: Number(row.today_count ?? 0),
        todayAdmins: Number(row.today_admins ?? 0),
        todayAdminsAtLeast: false,
        weekCount: Number(row.week_count ?? 0),
        moneyCount: Number(row.money_count ?? 0),
      };
    }
  } else if (!MISSING_FUNCTION.has(rpc.error.code ?? "")) {
    throw new Error(`Could not count the audit log: ${rpc.error.message}`);
  }

  // Before 20260924355000 is applied: the same figures from head counts on audit_log_ts_idx.
  const now = new Date();
  const dayStart = startOfUtcDay(now);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const scoped = () => {
    const q = supabase.from("audit_log").select("id", { count: "exact", head: true });
    return actorId ? q.eq("actor_id", actorId) : q;
  };
  let admins = supabase
    .from("audit_log")
    .select("actor_id")
    .eq("actor_type", "admin")
    .gte("ts", dayStart)
    .limit(FALLBACK_ADMIN_ROW_CAP);
  if (actorId) admins = admins.eq("actor_id", actorId);

  const [today, week, money, adminRows] = await Promise.all([
    scoped().gte("ts", dayStart),
    scoped().gte("ts", weekStart),
    scoped().gte("ts", weekStart).in("action", moneyActions),
    admins,
  ]);
  if (today.error || week.error || money.error) {
    throw new Error(`Could not count the audit log: ${(today.error ?? week.error ?? money.error)?.message}`);
  }
  const ids = (adminRows.data ?? []) as { actor_id: string | null }[];
  return {
    todayCount: today.count ?? 0,
    todayAdmins: adminRows.error ? null : new Set(ids.map((r) => r.actor_id).filter(Boolean)).size,
    todayAdminsAtLeast: !adminRows.error && ids.length >= FALLBACK_ADMIN_ROW_CAP,
    weekCount: week.count ?? 0,
    moneyCount: money.count ?? 0,
  };
}

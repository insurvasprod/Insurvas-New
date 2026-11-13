import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { rowVisible, type ProducerScope } from "@/lib/agency/visibility";

import { OPEN_STATUSES } from "./cases/ladder";

/**
 * The Retention rail's one warning per step (round 7, owner pick 0·A, 2026-11-10; docs/la4/mockups-r7/retention.html):
 * Cases: open cases past their deadline; Waiting on the carrier: requests to check or send; Win-back: clients on the
 * Win-back list to call now. Head reads only: nothing is synced or released here (the pages do that when opened).
 * Who counts what follows the pages: a producer their own policies, a retention rep the cases they own, a narrowed
 * agency session its producers'. A step whose table is missing is left out.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();
type Viewer = { tenantId: string; userId: string; role: string; scope: ProducerScope };
const CHUNK = 200;
const keyOf = (carrierId: string, policyNumber: string) => `${carrierId}|${policyNumber}`;

/** Keep the rows whose policy this viewer may see (a producer: credited to them; a narrowed session: its producers). */
async function visibleRows<T extends { carrier_id: string; policy_number: string }>(viewer: Viewer, rows: T[]): Promise<T[]> {
  const producer = viewer.role === "producer";
  if (!producer && viewer.scope === null) return rows;
  const numbers = [...new Set(rows.map((r) => r.policy_number))];
  const agentOf = new Map<string, string | null>();
  for (let i = 0; i < numbers.length; i += CHUNK) {
    const { data } = await db().from("policy_current").select("carrier_id, policy_number, agent_user_id").eq("tenant_id", viewer.tenantId).in("policy_number", numbers.slice(i, i + CHUNK));
    for (const p of (data ?? []) as Loose[]) agentOf.set(keyOf(p.carrier_id, p.policy_number), p.agent_user_id ?? null);
  }
  return rows.filter((r) => {
    const agent = agentOf.get(keyOf(r.carrier_id, r.policy_number)) ?? null;
    if (producer && agent !== viewer.userId) return false;
    return rowVisible(viewer.scope, agent);
  });
}

async function casesPastDue(viewer: Viewer, today: string): Promise<number | null> {
  let query = db().from("retention_case").select("carrier_id, policy_number").eq("tenant_id", viewer.tenantId)
    .in("status", [...OPEN_STATUSES]).neq("status", "waiting_on_carrier").not("step", "in", "(lost,paperwork)").lt("deadline", today).limit(5000);
  if (viewer.role === "retention") query = query.eq("owner_user_id", viewer.userId);
  const { data, error } = await query;
  if (error) return null;
  return (await visibleRows(viewer, (data ?? []) as Loose[])).length;
}

async function requestsToAct(viewer: Viewer, today: string): Promise<number | null> {
  const { data, error } = await db().from("servicing_request").select("carrier_id, policy_number, status, unprovable_fields, expected_effective_date")
    .eq("tenant_id", viewer.tenantId).in("status", ["draft", "submitted", "confirmed_by_carrier"]).limit(5000);
  if (error) return null;
  // As the board sorts them: unsent ("Send it"), or sent and needing a look ("Check it").
  const acting = ((data ?? []) as Loose[]).filter((r) => r.status === "draft" || r.status === "confirmed_by_carrier"
    || (Array.isArray(r.unprovable_fields) && r.unprovable_fields.length > 0) || (r.expected_effective_date && r.expected_effective_date < today));
  return (await visibleRows(viewer, acting)).length;
}

async function toCallNow(viewer: Viewer): Promise<number | null> {
  // A retention rep has no win-back calls (LA-5.8).
  if (viewer.role === "retention") return null;
  const { data, error } = await db().from("winback_candidate").select("carrier_id, source_policy_number, winback_band")
    .eq("tenant_id", viewer.tenantId).not("released_to_nurture_at", "is", null).neq("winback_band", "never").limit(5000);
  if (error) return null;
  const rows = ((data ?? []) as Loose[]).map((r) => ({ carrier_id: r.carrier_id as string, policy_number: r.source_policy_number as string }));
  return (await visibleRows(viewer, rows)).length;
}

export async function retentionStepCounts(viewer: Viewer): Promise<Record<string, number>> {
  const today = new Date().toISOString().slice(0, 10);
  const [cases, servicing, reinstatement] = await Promise.all([
    casesPastDue(viewer, today).catch(() => null),
    requestsToAct(viewer, today).catch(() => null),
    toCallNow(viewer).catch(() => null),
  ]);
  const counts: Record<string, number> = {};
  if (cases !== null) counts.cases = cases;
  if (servicing !== null) counts.servicing = servicing;
  if (reinstatement !== null) counts.reinstatement = reinstatement;
  return counts;
}

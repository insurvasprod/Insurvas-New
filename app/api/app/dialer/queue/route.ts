import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { DialerWorkflowError, diagnoseAssignedQueue, diagnoseEmptyQueue, getDialerStats, getQueuePreview } from "@/lib/dialerScripts/service";
import { PRIORITY_TIERS } from "@/lib/dialerScripts/display";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";

// The same roles as every dialer route (a test pins them to rolesWith("dialer.use")). A literal
// array because the money-route guard reads these lists statically.
const DIALER_ROLES = ["owner", "producer", "setter"] as const;

const querySchema = z.object({ priority: z.enum(["all", "high", "medium", "low"]).default("all") });

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The campaign's lead type ("list" | "realtime" | "aged"), a recycle pass, and the open callback's time. */
type RowExtra = { leadType: string | null; recycled: boolean; callbackAt: string | null };

/**
 * Every read filtered to the tenant (the service client has no RLS predicate) and bounded by the list
 * (at most its hundred leads), one read per table, never one per row. A failed read leaves the fields
 * empty: the queue still serves.
 */
async function rowExtras(tenantId: string, leadIds: string[]): Promise<Map<string, RowExtra>> {
  const out = new Map<string, RowExtra>();
  const ids = [...new Set(leadIds.filter(Boolean))];
  if (!ids.length) return out;
  try {
    const db = getSupabaseServiceClient() as unknown as SupabaseClient;
    const [leads, callbacks] = await Promise.all([
      db.from("agent_leads").select("id, campaign_id, recycle_count").eq("tenant_id", tenantId).in("id", ids),
      db.from("tenant_callbacks").select("lead_id, scheduled_at_utc").eq("tenant_id", tenantId).in("lead_id", ids).in("status", ["scheduled", "due"]).order("scheduled_at_utc", { ascending: true }).limit(500),
    ]);
    const leadRows = (!leads.error && Array.isArray(leads.data) ? leads.data : []) as Row[];
    const campaignIds = [...new Set(leadRows.map((row) => text(row.campaign_id)).filter(Boolean))];
    const campaigns = campaignIds.length ? await db.from("tenant_campaigns").select("id, lead_type").eq("tenant_id", tenantId).in("id", campaignIds) : null;
    const types = new Map(((campaigns && !campaigns.error && Array.isArray(campaigns.data) ? campaigns.data : []) as Row[]).map((row) => [text(row.id), text(row.lead_type) || null]));
    const due = new Map<string, string>();
    for (const row of (!callbacks.error && Array.isArray(callbacks.data) ? callbacks.data : []) as Row[]) {
      const lead = text(row.lead_id);
      if (lead && !due.has(lead) && text(row.scheduled_at_utc)) due.set(lead, text(row.scheduled_at_utc));
    }
    for (const row of leadRows) {
      const id = text(row.id);
      out.set(id, { leadType: types.get(text(row.campaign_id)) ?? null, recycled: Number(row.recycle_count ?? 0) > 0, callbackAt: due.get(id) ?? null });
    }
  } catch {
    // Display only; the list is unchanged without it.
  }
  return out;
}

/** Applications this agent started since the dialer's own "today" began (the stats' `since`). */
async function appsToday(tenantId: string, agentId: string, since: string): Promise<number | null> {
  try {
    const db = getSupabaseServiceClient() as unknown as SupabaseClient;
    const result = await db.from("tenant_applications").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("created_by", agentId).gte("created_at", since);
    return result.error ? null : result.count ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/app/dialer/queue — the Priority queue list.
 *
 * Read-only: dialer_queue_preview claims nothing and writes nothing, so a GET is right here (the
 * serve and the pick are POSTs because they lock). Bounded: the next 100 servable leads in tier
 * order (the function's own ceiling), each with its campaign and phone, and a count capped at 1,000. The High / Medium / Low filter narrows this list only; Serve
 * next is unaffected by it. Read-only accounts may look, since looking changes nothing.
 */
export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("outbound_dialing", DIALER_ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = querySchema.safeParse({ priority: request.nextUrl.searchParams.get("priority") ?? undefined });
  if (!parsed.success) return NextResponse.json({ error: "Choose All, High, Medium or Low" }, { status: 400 });
  const tiers = parsed.data.priority === "high" ? PRIORITY_TIERS.High : parsed.data.priority === "medium" ? PRIORITY_TIERS.Medium : parsed.data.priority === "low" ? PRIORITY_TIERS.Low : null;
  try {
    // The header's own-today figures ride along: the screen reloads this after every serve and
    // disposition, which is exactly when they change. A failed count is null, never a fake 0.
    // AG-0.5 / AG-0.10: in an agency a narrow session lists (and counts) only the leads assigned to it;
    // the stats were always its own. Null scope: the whole servable list, as before.
    const scope = await scopeFor(auth.context);
    const [preview, stats] = await Promise.all([
      getQueuePreview({ tenantId: auth.context.tenantId, agentId: auth.context.userId, tiers, scope }),
      getDialerStats({ tenantId: auth.context.tenantId, agentId: auth.context.userId }).catch(() => null),
    ]);
    // An empty list says why (LA-2.8-6), read-only: the same diagnosis Serve next gives, without
    // pressing it. Only for the whole list; a priority filter that is empty is just a filter.
    const emptyRead = preview.available && preview.count === 0 && tiers === null
      // A scoped list is the agent's own assigned leads, so its emptiness is diagnosed from them alone.
      ? (scope === null ? diagnoseEmptyQueue(auth.context.tenantId, auth.context.userId) : diagnoseAssignedQueue(auth.context.tenantId, auth.context.userId)).catch(() => null)
      : Promise.resolve(null);
    // The phone's dialer (board C7 / C7e), read beside the diagnosis and never failing the list: today's
    // applications started by this agent (the "Apps" figure), and per listed lead the campaign's lead type,
    // whether it is on a recycle pass and its open callback's time. Null / absent = could not be read.
    const [empty, apps, extras] = await Promise.all([
      emptyRead,
      stats ? appsToday(auth.context.tenantId, auth.context.userId, stats.since) : Promise.resolve(null),
      preview.available ? rowExtras(auth.context.tenantId, preview.rows.map((row) => row.leadId)) : Promise.resolve(new Map<string, RowExtra>()),
    ]);
    // Each row's High / Medium / Low, by the same tiers the filter above uses, so the chip and the filter agree.
    const priorityOf = (tier: number) => (Object.entries(PRIORITY_TIERS).find(([, list]) => list.includes(tier))?.[0] ?? null);
    const body = preview.available ? { ...preview, rows: preview.rows.map((row) => ({ ...row, priority: priorityOf(row.tier), ...(extras.get(row.leadId) ?? {}) })) } : preview;
    return NextResponse.json({ ...body, stats, apps, emptyReason: empty?.message ?? null, emptyCode: empty?.code ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof DialerWorkflowError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the queue" }, { status });
  }
}

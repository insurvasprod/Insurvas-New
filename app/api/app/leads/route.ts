import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { countAgentLeadsByPipeline, countAgentLeadsByStage, createAgentLead, filterAgentLeadsPage, getAgentTemplate, LEADS_PAGE_SIZE, visibleLeadIds, withSubmitterNames } from "@/lib/agentTemplates/service";
import { listPipelines } from "@/lib/pipelines/service";
import { audit } from "@/lib/audit/log";
import { leadWorkFacts } from "@/lib/agentTemplates/leadWorkFacts";
import { anyRoleHasPermission } from "@/lib/tenantAuth/permissions";
import { contextRoles } from "@/lib/tenantAuth/requireTenant";
import { scopeFor } from "@/lib/agency/visibility";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { leadRowExtras, type LeadRowExtras } from "@/lib/leadWorkspace/listExtras";
import { findExistingCustomer } from "@/lib/existingCustomerPreflight/service";
import { guardLead } from "@/lib/agency/guards";

// LA-2.12. The book of business is the licensed agent's — it carries premiums, quotes and
// applications, which is the exact list a setter may not see. The setter is excluded by naming the
// four roles that already had this route rather than by narrowing it to ["owner"], so this change
// adds one refusal and takes nobody's access away.
const NOT_SETTER = ["owner", "producer", "assistant", "bookkeeper"] as const;

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", NOT_SETTER, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  try {
    // Pipelines are tenant-scoped and don't depend on the template, so they load alongside it.
    // AG-0.5: a narrowed agency session (producer, manager, assistant) gets its producers' leads only.
    // The scope comes from the session; null (solo tenant, owner, bookkeeper) reads the book as before.
    // The scope was read in the auth round trip (prefetchScope), so a narrowed session's visible lead ids
    // (which need no template) are read beside the template rather than after it.
    const scope = await scopeFor(auth.context);
    const visible = scope === null ? undefined : visibleLeadIds(auth.context.tenantId, scope);
    // Awaited inside filterAgentLeadsPage; this only keeps a template failure from leaving it unobserved.
    visible?.catch(() => undefined);
    const params = request.nextUrl.searchParams;
    // The board loads one pipeline in pages, newest first (2026-11-12): ?pipeline=<id>&page=<n>. Page 0 (the default)
    // also carries the template, the pipelines and each pipeline's count (the board's tabs); with no pipeline asked it
    // opens on the one the board would choose, the marketing pipeline, else the first. A later page carries its leads.
    // A narrowed agency session reads its producers' leads whole, every pipeline, as before.
    const page = Math.max(0, Math.min(1_000, Number.parseInt(params.get("page") ?? "0", 10) || 0));
    const asked = params.get("pipeline");
    const askedPipeline = asked && /^[0-9a-f-]{36}$/i.test(asked) ? asked : null;
    const [template, pipelines] = await Promise.all([
      getAgentTemplate(auth.context.tenantId, auth.context.userId),
      page === 0 ? listPipelines(auth.context.tenantId) : Promise.resolve([]),
    ]);
    const pipelineId = scope !== null ? null : page === 0
      ? (pipelines.find((item) => item.id === askedPipeline) ?? pipelines.find((item) => item.partner_type === "marketing") ?? pipelines[0])?.id ?? null
      : askedPipeline;
    const search = params.get("q")?.trim() ?? "";
    // The tabs' counts, beside the page (whole-book reads only; a narrowed session counts what it was sent).
    const totalsRead = scope === null && page === 0 && pipelines.length ? countAgentLeadsByPipeline(auth.context.tenantId, template, pipelines.map((item) => item.id), search) : Promise.resolve(null);
    totalsRead.catch(() => undefined);
    // The open pipeline's stage counts (the phone's stage chips), read the same way as the pipeline totals.
    const openPipeline = scope === null && page === 0 && pipelineId ? pipelines.find((item) => item.id === pipelineId) : undefined;
    const openStageIds = ((openPipeline as { stages?: { id: string }[] } | undefined)?.stages ?? []).map((stage) => stage.id);
    const stageTotalsRead = openPipeline && openStageIds.length ? countAgentLeadsByStage(auth.context.tenantId, template, openPipeline.id, openStageIds, search) : Promise.resolve(null);
    stageTotalsRead.catch(() => undefined);
    const direction = params.get("direction") === "desc" ? "desc" : "asc";
    const { leads: found, hasMore } = await filterAgentLeadsPage(
      auth.context.tenantId,
      template,
      search,
      params.get("filter_field") ?? "",
      params.get("filter_value") ?? "",
      params.get("sort") ?? "",
      direction,
      scope,
      visible,
      scope === null ? page : null,
      pipelineId,
    );
    // Who holds each lead, and — for roles that may see money — what it was quoted at. The board's
    // Unassigned and annualised figures are counted from these, not stored. Read beside the submitter
    // names: both need only the lead ids.
    const money = anyRoleHasPermission(contextRoles(auth.context), "money.view");
    const [leads, facts, totals, stageTotals, sources, extras] = await Promise.all([
      withSubmitterNames(auth.context.tenantId, found),
      // When each lead entered its stage came with the leads themselves (speed pass 2026-11-12: 7 fewer reads).
      leadWorkFacts(auth.context.tenantId, found.map((lead) => lead.id), money, new Map(found.map((lead) => [lead.id, (lead as { stage_entered_at?: string | null }).stage_entered_at ?? null]))),
      totalsRead.catch(() => null),
      stageTotalsRead.catch(() => null),
      // Where each lead came from (its first source row's vendor and kind), for the phone's list rows.
      firstSources(auth.context.tenantId, found.map((lead) => lead.id)).catch(() => new Map<string, LeadSourceFact>()),
      // The phone's rows and cards (2026-11-26): the soonest open callback, the screening result and, with
      // ?callable=1 only, whether the lead may be dialled now (the dial paths' own calling-window check).
      leadRowExtras(auth.context.tenantId, found.map((lead) => ({ id: lead.id, values: (lead as { values?: unknown }).values })), { callable: params.get("callable") === "1" }).catch(() => new Map<string, LeadRowExtras>()),
    ]);
    const enriched = leads.map((lead) => {
      const fact = facts.get(lead.id);
      const extra = extras.get(lead.id);
      return { ...lead, owner_user_id: fact?.ownerUserId ?? null, owner_name: fact?.ownerName ?? null, disposition: fact?.disposition ?? null, disposition_at: fact?.dispositionAt ?? null, stage_entered_at: fact?.stageEnteredAt ?? null, source_name: sources.get(lead.id)?.vendorName ?? null, source_type: sources.get(lead.id)?.sourceType ?? null, monthly_premium_cents: money ? fact?.monthlyPremiumCents ?? null : null, callback_at: extra?.callbackAt ?? null, callback_timezone: extra?.callbackTimezone ?? null, screening_outcome: extra?.screeningOutcome ?? null, screening_warning: extra?.screeningWarning ?? false, callable_now: extra?.callableNow ?? null };
    });
    // `role` travels with the payload so the workspace can decide what to OFFER, not just what to
    // allow. Stage and pipeline editing is owner-only (LA-1.9 criterion 1), and a producer shown an
    // "Edit stages" button would get a 403 from a control that looked available — the same dead-end
    // this audit has been removing elsewhere. The API remains the enforcement; this is the label.
    return NextResponse.json({ template, leads: enriched, page, pageSize: LEADS_PAGE_SIZE, hasMore, pipelineId, totals, stageTotals, pipelines, role: auth.context.role, currentUserId: auth.context.userId, money, readOnly: auth.entitlement.access === "read_only" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load leads" }, { status: 500 });
  }
}

type LeadSourceFact = { vendorName: string | null; sourceType: string | null };
type SourceRow = Record<string, unknown>;
type SourceQuery = PromiseLike<{ data: SourceRow[] | null; error: { message: string } | null }> & {
  select(columns: string): SourceQuery;
  eq(column: string, value: unknown): SourceQuery;
  in(column: string, values: unknown[]): SourceQuery;
  order(column: string, options?: { ascending?: boolean }): SourceQuery;
};
/** A uuid is 36 characters; 150 of them keep the request line well under PostgREST's limit. */
const SOURCE_CHUNK = 150;
const textOf = (value: unknown) => (typeof value === "string" && value ? value : null);

/**
 * Each lead's first source row (tenant_lead_sources, oldest first, as lineage.ts reads one lead) with
 * its campaign's vendor: "Apex Leads", or the kind of source when no vendor is named. Read for the
 * page's leads only, in chunks, tenant-filtered.
 */
async function firstSources(tenantId: string, leadIds: string[]): Promise<Map<string, LeadSourceFact>> {
  const out = new Map<string, LeadSourceFact>();
  if (!leadIds.length) return out;
  const db = getSupabaseServiceClient() as unknown as { from(table: string): SourceQuery };
  const chunks: string[][] = [];
  for (let start = 0; start < leadIds.length; start += SOURCE_CHUNK) chunks.push(leadIds.slice(start, start + SOURCE_CHUNK));
  const pages = await Promise.all(chunks.map((ids) => db.from("tenant_lead_sources").select("lead_id, campaign_id, source_type, created_at").eq("tenant_id", tenantId).in("lead_id", ids).order("created_at", { ascending: true })));
  const first = new Map<string, { campaignId: string | null; sourceType: string | null }>();
  for (const page of pages) {
    if (page.error) continue;
    for (const row of page.data ?? []) {
      const leadId = textOf(row.lead_id);
      if (leadId && !first.has(leadId)) first.set(leadId, { campaignId: textOf(row.campaign_id), sourceType: textOf(row.source_type) });
    }
  }
  const campaignIds = [...new Set([...first.values()].map((row) => row.campaignId).filter((id): id is string => Boolean(id)))];
  const campaigns = campaignIds.length ? await db.from("tenant_campaigns").select("id, vendor_id").eq("tenant_id", tenantId).in("id", campaignIds) : { data: [], error: null };
  const vendorOf = new Map((campaigns.error ? [] : campaigns.data ?? []).map((row) => [String(row.id), textOf(row.vendor_id)]));
  const vendorIds = [...new Set([...vendorOf.values()].filter((id): id is string => Boolean(id)))];
  const vendors = vendorIds.length ? await db.from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId).in("id", vendorIds) : { data: [], error: null };
  const vendorName = new Map((vendors.error ? [] : vendors.data ?? []).map((row) => [String(row.id), textOf(row.name)]));
  for (const [leadId, row] of first) {
    const vendorId = row.campaignId ? vendorOf.get(row.campaignId) ?? null : null;
    out.set(leadId, { vendorName: vendorId ? vendorName.get(vendorId) ?? null : null, sourceType: row.sourceType });
  }
  return out;
}

/** The roles the existing-customer check is open to (the same as POST /api/app/leads/:id/preflight). */
const CHECKERS = ["owner", "producer", "assistant"] as const;

/**
 * POST /api/app/leads?check=1 { values }: the existing-customer check (LA-1.24, findExistingCustomer)
 * on the answers as typed, BEFORE anything is saved (board D7). Nothing is written. Each earlier lead
 * it matches comes back with its stage and owner only when this person may open that lead (AG-0.5);
 * otherwise only that it exists.
 */
async function checkBeforeSaving(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", CHECKERS, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { values?: unknown } | null;
  const values = body?.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values as Record<string, unknown> : null;
  if (!values) return NextResponse.json({ error: "Type the lead's answers first" }, { status: 400 });
  try {
    const { status, matches } = await findExistingCustomer({ tenantId: auth.context.tenantId, values });
    const leadMatches = matches.filter((match) => match.leadId && match.sourceType !== "contact").slice(0, 5);
    const ids = leadMatches.map((match) => match.leadId as string);
    const db = getSupabaseServiceClient();
    const [rows, queue, pipelines] = ids.length ? await Promise.all([
      db.from("agent_leads").select("id, stage_id").eq("tenant_id", auth.context.tenantId).in("id", ids),
      db.from("lead_queue").select("lead_id, owner_user_id, queued_at").eq("tenant_id", auth.context.tenantId).in("lead_id", ids).order("queued_at", { ascending: false }),
      listPipelines(auth.context.tenantId),
    ]) : [null, null, []];
    const stageOf = new Map((rows?.data ?? []).map((row) => [row.id, row.stage_id]));
    const ownerOf = new Map<string, string | null>();
    for (const row of queue?.data ?? []) if (!ownerOf.has(row.lead_id)) ownerOf.set(row.lead_id, row.owner_user_id);
    const ownerIds = [...new Set([...ownerOf.values()].filter((id): id is string => Boolean(id)))];
    const users = ownerIds.length ? await db.from("users").select("id, name").in("id", ownerIds) : { data: [] as { id: string; name: string }[] };
    const nameOf = new Map((users.data ?? []).map((user) => [user.id, user.name]));
    const stageName = new Map((pipelines as Array<{ stages?: Array<{ id: string; name: string }> }>).flatMap((pipeline) => (pipeline.stages ?? []).map((stage) => [stage.id, stage.name] as const)));
    const described = await Promise.all(leadMatches.map(async (match) => {
      const id = match.leadId as string;
      const openable = !(await guardLead(auth.context, id));
      const owner = ownerOf.get(id) ?? null;
      const stage = stageOf.get(id) ?? null;
      return {
        leadId: id,
        openable,
        stageName: openable && stage ? stageName.get(stage) ?? null : null,
        ownerName: openable && owner ? nameOf.get(owner) ?? null : null,
        matchedOn: match.matchedOn ?? [],
        submittedAt: match.submittedAt ?? null,
      };
    }));
    return NextResponse.json({ status, matches: described, contacts: matches.filter((match) => match.sourceType === "contact").length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not check for an existing lead" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get("check") === "1") return checkBeforeSaving(request);
  const auth = await requireFeatureRole("book_of_business", NOT_SETTER, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { values?: unknown; stage_id?: string; stage_key?: string } | null;
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    const lead = await createAgentLead(auth.context.tenantId, auth.context.userId, template, body?.values, body?.stage_id ?? body?.stage_key);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_stage_changed", targetType: "agent_lead", targetId: lead.id, metadata: { operation: "created", stageId: lead.stage_id }, request });
    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create lead" }, { status: 400 });
  }
}

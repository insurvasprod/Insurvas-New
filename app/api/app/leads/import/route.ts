import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { audit, auditMany } from "@/lib/audit/log";
import { importAgentLeads, getAgentTemplate } from "@/lib/agentTemplates/service";
import { recordImportFailure } from "@/lib/agentTemplates/errors";
import { MAX_LEAD_IMPORT_ROWS } from "@/lib/agentTemplates/csv";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { listPipelines } from "@/lib/pipelines/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { outboundLimitResponse, outboundLimitSnapshot, recordOutboundUsage } from "@/lib/metering/outbound";
import { isImportDateOrder, isRequiredLeadImportField, type ImportDateOrder } from "@/lib/agentTemplates/csv";

const LEAD_IMPORT_ROLES = ["owner", "producer", "assistant"] as const;
type CampaignOption = { id: string; vendor_id: string; name: string; status: string };
type VendorOption = { id: string; name: string; lead_type: string; status: string };
type MappingOption = { id: string; vendor_id: string; product_code: string; mapping: Record<string, string | null>; updated_at: string; date_order?: ImportDateOrder | null };
const isMissingColumn = (error: { message: string; code?: string }) => ["42703", "PGRST204"].includes(error.code ?? "") || /date_order/.test(error.message);
type LooseQuery = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> & { select(columns: string): LooseQuery; eq(column: string, value: unknown): LooseQuery; in(column: string, values: string[]): LooseQuery; order(column: string, options?: unknown): LooseQuery; maybeSingle(): Promise<{ data: unknown; error: { message: string; code?: string } | null }> };

async function context() {
  const auth = await requireFeatureRole("lead_import", LEAD_IMPORT_ROLES);
  if (auth instanceof NextResponse) return auth;
  // Independent tenant-scoped reads, so one round trip rather than two.
  const [template, pipelines] = await Promise.all([
    getAgentTemplate(auth.context.tenantId, auth.context.userId),
    listPipelines(auth.context.tenantId),
  ]);
  // Manual list imports are agent-owned leads, so they enter the default marketing pipeline. A
  // single pipeline also keeps a friendly stage name unambiguous when publisher/affiliate
  // pipelines happen to use the same stage labels.
  // The default pipeline with no partner type, when the tenant has one, is where leads with no
  // partner enter (Settings → Pipelines); otherwise the default marketing pipeline, as before.
  const pipeline = pipelines.find((item) => item.partner_type === null && item.is_default) ?? pipelines.find((item) => item.partner_type === "marketing" && item.is_default) ?? pipelines.find((item) => item.is_default) ?? pipelines[0];
  const db = getSupabaseServiceClient() as unknown as { from(table: string): LooseQuery };
  const readMappings = (columns: string) => db.from("tenant_import_mappings").select(columns).eq("tenant_id", auth.context.tenantId).eq("product_code", template.template.product_code).order("updated_at", { ascending: false });
  const [campaigns, vendors, withDateOrder] = await Promise.all([
    // Drafts too: "New campaign" on Vendors & campaigns creates a draft, and a tenant who just made
    // one to import into must find it here. The screen says a draft is not dialled until activated.
    db.from("tenant_campaigns").select("id, vendor_id, name, status").eq("tenant_id", auth.context.tenantId).in("status", ["draft", "active", "paused"]),
    db.from("tenant_lead_vendors").select("id, name, lead_type, status").eq("tenant_id", auth.context.tenantId).order("name"),
    readMappings("id, vendor_id, product_code, mapping, updated_at, date_order"),
  ]);
  // `date_order` arrives with 20260924343000. Before it, the saved maps are read as they always were.
  const mappings = withDateOrder.error && isMissingColumn(withDateOrder.error) ? await readMappings("id, vendor_id, product_code, mapping, updated_at") : withDateOrder;
  return { auth, template, stages: pipeline?.stages ?? [], campaigns: campaigns.error ? [] : campaigns.data as CampaignOption[], vendors: vendors.error ? [] : vendors.data as VendorOption[], mappings: mappings.error ? [] : mappings.data as MappingOption[] };
}

export async function GET() {
  const result = await context();
  if (result instanceof NextResponse) return result;
  return NextResponse.json({
    product: { code: result.template.template.product_code, name: result.template.template.product_name },
    productCode: result.template.template.product_code,
    // Imports need the four identity fields for routing, dedupe, and screening; the remaining
    // application fields can be completed during review and calling.
    fields: result.template.template.fields.map((field) => ({ key: field.field_key, label: field.label, type: field.type, required: isRequiredLeadImportField(field), options: field.options, sort_order: field.sort_order })),
    stages: result.stages.filter((stage) => !stage.is_archived).map((stage) => ({ id: stage.id, name: stage.name })),
    campaigns: result.campaigns,
    // Vendors & campaigns is owner/producer only. An assistant with no campaign to import into is
    // told to ask, rather than sent to a page that will refuse them.
    canCreateCampaigns: result.auth.context.role === "owner" || result.auth.context.role === "producer",
    vendors: result.vendors as VendorOption[],
    mappings: result.mappings as MappingOption[],
    limits: await outboundLimitSnapshot(result.auth.context.tenantId),
    // Served from the parser's own constant rather than repeated here, so the screen can never
    // advertise a limit the parser does not enforce.
    maxRows: MAX_LEAD_IMPORT_ROWS,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const result = await context();
  if (result instanceof NextResponse) return result;
  const body = await request.json().catch(() => null) as { csv?: unknown; campaign_id?: unknown; vendor_id?: unknown; mapping?: unknown; date_order?: unknown } | null;
  if (typeof body?.csv !== "string") return NextResponse.json({ error: "Choose a CSV file to import" }, { status: 400 });
  // Passed through only when the caller says. Without one, slash dates are refused exactly as before.
  if (body.date_order !== undefined && body.date_order !== null && !isImportDateOrder(body.date_order))
    return NextResponse.json({ error: "date_order must be \"mdy\" or \"dmy\"" }, { status: 400 });
  const dateOrder = isImportDateOrder(body.date_order) ? body.date_order : null;
  const suppliedKey = request.headers.get("Idempotency-Key")?.trim();
  if (suppliedKey && suppliedKey.length > 200) return NextResponse.json({ error: "Idempotency-Key is too long" }, { status: 400 });
  const idempotencyKey = suppliedKey || createHash("sha256").update(body.csv, "utf8").digest("hex");
  const supabase = getSupabaseServiceClient();
  const claimed = await supabase.from("agent_lead_import_batches").insert({ tenant_id: result.auth.context.tenantId, idempotency_key: idempotencyKey, created_by: result.auth.context.userId }).select("id, status, response, error_message").maybeSingle();
  if (claimed.error?.code === "23505") {
    const existing = await supabase.from("agent_lead_import_batches").select("status, response, error_message").eq("tenant_id", result.auth.context.tenantId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existing.error || !existing.data) return NextResponse.json({ error: "Could not resolve the existing import request" }, { status: 500 });
    if (existing.data.status === "completed" && existing.data.response) return NextResponse.json(existing.data.response, { status: 200 });
    if (existing.data.status === "failed") return NextResponse.json({ error: existing.data.error_message ?? "This import request failed; submit it again with a new key" }, { status: 400 });
    return NextResponse.json({ error: "This import request is already being processed" }, { status: 409 });
  }
  if (claimed.error || !claimed.data) return NextResponse.json({ error: "Could not start the import request" }, { status: 500 });
  try {
    const campaignId = typeof body.campaign_id === "string" && body.campaign_id ? body.campaign_id : null;
    const vendorId = typeof body.vendor_id === "string" && body.vendor_id ? body.vendor_id : null;
    // The direct import keeps its original rule — active or paused campaigns only. Drafts are listed
    // for the reviewed importer, which reports that a draft's leads are not served yet.
    const campaign = campaignId ? result.campaigns.find((item: CampaignOption & { vendor_id?: string }) => item.id === campaignId && item.status !== "draft") : null;
    if (campaignId && !campaign) return NextResponse.json({ error: "Choose a valid active campaign" }, { status: 400 });
    if (vendorId && campaign && campaign.vendor_id !== vendorId) return NextResponse.json({ error: "The selected vendor does not own this campaign" }, { status: 400 });
    const mappingVendorId = vendorId ?? campaign?.vendor_id ?? null;
    let mapping = body.mapping;
    if (!mapping && mappingVendorId) {
      const saved = result.mappings.find((item: MappingOption) => item.vendor_id === mappingVendorId);
      mapping = saved?.mapping;
    }
    const { imported, rejected, scrubMarked } = await importAgentLeads(result.auth.context.tenantId, result.auth.context.userId, result.template, body.csv, result.stages, campaignId, mapping && typeof mapping === "object" && !Array.isArray(mapping) ? mapping as Record<string, string | null> : undefined, dateOrder);
    const createdCount = imported.filter((item) => item.created).length;
    if (createdCount > 0) await recordOutboundUsage(result.auth.context.tenantId, "monthly_leads_imported", createdCount, `${idempotencyKey}:monthly_leads_imported`, idempotencyKey);
    // Same per-row audit rows as before, written in chunks rather than one insert per lead.
    await auditMany(imported.map((item) => ({ actorType: "tenant" as const, actorId: result.auth.context.userId, action: "tenant.lead_stage_changed" as const, targetType: "agent_lead", targetId: item.lead.id, metadata: { operation: "imported", rowNumber: item.rowNumber, stageId: item.lead.stage_id }, request })));
    // Rejections are audited as one event, not one per row: a 180-row rejection is a single fact
    // about a vendor's list, and 180 audit rows would bury the import itself. The per-row evidence
    // lives in the rejection ledger, which is where a credit claim reads it from.
    if (rejected.length > 0) {
      await audit({ actorType: "tenant", actorId: result.auth.context.userId, action: "tenant.lead_import_scrub_rejected", targetType: "tenant_campaign", targetId: campaignId ?? undefined, metadata: { rejected: rejected.length, imported: imported.length, byOutcome: rejected.reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.outcome]: (counts[item.outcome] ?? 0) + 1 }), {}) }, request });
    }
    // `servable` is the difference between "imported" and "imported and the dialer will hand these
    // out", which a row count cannot express. An attributed lead whose campaign is not marked
    // scrubbed is invisible to `serve_next_lead`, and that used to be every imported list forever.
    const responseBody = {
      imported: imported.length,
      rejected: rejected.length,
      rejections: rejected.map((item) => ({ rowNumber: item.rowNumber, outcome: item.outcome, detail: item.detail })),
      leads: imported.map((item) => ({ rowNumber: item.rowNumber, id: item.lead.id })),
      servable: campaignId ? scrubMarked : true,
      ...(campaignId && !scrubMarked
        ? { warning: "The leads imported, but this campaign could not be marked as scrubbed, so the dialer will not serve them yet. Mark it on Vendors & campaigns, or re-run the import." }
        : {}),
    };
    const completed = await supabase.from("agent_lead_import_batches").update({ status: "completed", response: responseBody, completed_at: new Date().toISOString() }).eq("id", claimed.data.id).eq("tenant_id", result.auth.context.tenantId);
    if (completed.error) throw new Error("Could not finalize the import request");
    return NextResponse.json(responseBody, { status: 201, headers: { "Idempotency-Key": idempotencyKey } });
  } catch (error) {
    const limit = outboundLimitResponse(error);
    if (limit) {
      // Release the claim. Left 'processing', the same file was refused as "already being processed"
      // for good, even after the plan was raised (found 2026-09-25); marked 'failed' it would be
      // refused just the same, since the key is the file's hash. Nothing was imported, so the claim
      // is dropped and the same file can be sent again once there is room.
      await supabase.from("agent_lead_import_batches").delete().eq("id", claimed.data.id).eq("tenant_id", result.auth.context.tenantId).eq("status", "processing");
      return NextResponse.json(limit, { status: 403 });
    }
    const failure = recordImportFailure(error, "direct import");
    // `cause`, not `message`. The batch row is the operator's record of what happened, and storing
    // the user-facing "temporarily unavailable, please try again later" there loses the only
    // durable evidence of WHY — which is the whole reason a broken database contract could look
    // like a transient blip for as long as it did.
    await supabase.from("agent_lead_import_batches").update({ status: "failed", error_message: failure.cause || failure.message }).eq("id", claimed.data.id).eq("tenant_id", result.auth.context.tenantId);
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.status });
  }
}

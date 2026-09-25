import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { IMPORT_DATE_ORDERS, sanitizeImportMapping } from "@/lib/agentTemplates/csv";
import { getAgentTemplate } from "@/lib/agentTemplates/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

const roles = ["owner", "producer", "assistant"] as const;
// `date_order` is optional: omitted, a saved format is left as it is; null clears it.
const schema = z.object({ vendor_id: z.string().uuid(), product_code: z.string().trim().min(1).max(80), mapping: z.record(z.string(), z.string().nullable()), date_order: z.enum(IMPORT_DATE_ORDERS).nullable().optional() }).strict();

type DbError = { message: string; code?: string };
type DbQuery = PromiseLike<{ data: unknown; error: DbError | null }> & { select(columns: string): DbQuery; eq(column: string, value: unknown): DbQuery; maybeSingle(): Promise<{ data: unknown; error: DbError | null }>; upsert(value: unknown, options?: unknown): DbQuery };
type Db = { from(table: string): DbQuery };
type SavedMapping = { id: string; vendor_id: string; product_code: string; mapping: Record<string, string | null>; updated_at: string; date_order?: "mdy" | "dmy" | null };

/** `tenant_import_mappings.date_order` arrives with 20260924343000. */
const isMissingDateOrder = (error: DbError | null) => Boolean(error) && (["42703", "PGRST204"].includes(error?.code ?? "") || /date_order/.test(error?.message ?? ""));

export async function PUT(request: NextRequest) {
  const auth = await requireFeatureRole("lead_import", roles, { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message ?? "Enter a valid import mapping" }, { status: 400 });
  try {
    const template = await getAgentTemplate(auth.context.tenantId, auth.context.userId);
    if (body.data.product_code !== template.template.product_code) return NextResponse.json({ error: "This product is not assigned to the current workspace" }, { status: 400 });
    const db = getSupabaseServiceClient() as unknown as Db;
    const vendor = await db.from("tenant_lead_vendors").select("id").eq("tenant_id", auth.context.tenantId).eq("id", body.data.vendor_id).maybeSingle();
    if (vendor.error || !vendor.data) return NextResponse.json({ error: "Choose a vendor from this workspace" }, { status: 400 });
    const mapping = sanitizeImportMapping(body.data.mapping, template.template.fields);
    const row = { tenant_id: auth.context.tenantId, vendor_id: body.data.vendor_id, product_code: body.data.product_code, mapping, created_by: auth.context.userId, updated_at: new Date().toISOString() };
    const wantsDateOrder = body.data.date_order !== undefined;
    const upsert = (value: Record<string, unknown>, columns: string) => db.from("tenant_import_mappings").upsert(value, { onConflict: "tenant_id,vendor_id,product_code" }).select(columns).maybeSingle();
    let saved = await upsert(wantsDateOrder ? { ...row, date_order: body.data.date_order } : row, "id, vendor_id, product_code, mapping, updated_at, date_order");
    // Before the migration the map is still worth keeping: save it without the date format and say
    // so, rather than refusing the whole save over one column.
    let note: string | null = null;
    if (isMissingDateOrder(saved.error)) {
      saved = await upsert(row, "id, vendor_id, product_code, mapping, updated_at");
      if (wantsDateOrder) note = "The column map was saved. The date format was not: this needs a database update that has not been applied yet.";
    }
    if (saved.error || !saved.data) throw new Error("Could not save the vendor mapping");
    const savedMapping = saved.data as SavedMapping;
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.import_mapping_saved", targetType: "tenant_import_mapping", targetId: savedMapping.id, metadata: { vendorId: body.data.vendor_id, productCode: body.data.product_code, mappedColumns: Object.keys(mapping).length, ...(wantsDateOrder && !note ? { dateOrder: body.data.date_order } : {}) }, request });
    return NextResponse.json({ mapping: savedMapping, ...(note ? { note } : {}) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the vendor mapping" }, { status: 400 });
  }
}

import { NextResponse, type NextRequest } from "next/server";

import { getTenantTemplateForProduct } from "@/lib/agentTemplates/service";
import { audit } from "@/lib/audit/log";
import { archivePartnerFormPreset, listPartnerFormPresets, savePartnerFormPreset } from "@/lib/partnerFormPresets/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const owner = ["owner"] as const;
type Choice = { field_key: string; is_required?: boolean; sort_order?: number };

function choices(value: unknown, fieldKeys: Set<string>): Choice[] | null {
  if (!Array.isArray(value)) return null;
  const output = value.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Choice : null).filter((item): item is Choice => Boolean(item)).map((item, index) => ({ field_key: item.field_key, is_required: item.is_required === true, sort_order: Number.isInteger(item.sort_order) ? item.sort_order : index }));
  return output.length === value.length && output.every((item) => typeof item.field_key === "string" && fieldKeys.has(item.field_key)) ? output : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params; const productCode = new URL(request.url).searchParams.get("product_code");
  if (!UUID.test(id) || !productCode) return NextResponse.json({ error: "Choose a publisher and product" }, { status: 400 });
  try { return NextResponse.json({ presets: await listPartnerFormPresets(auth.context.tenantId, productCode) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load form presets" }, { status: 400 }); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params;
  const body = await request.json().catch(() => null) as { id?: unknown; product_code?: unknown; name?: unknown; fields?: unknown; verification_fields?: unknown } | null;
  if (!UUID.test(partnerId) || typeof body?.product_code !== "string" || typeof body.name !== "string" || body.id !== undefined && (typeof body.id !== "string" || !UUID.test(body.id))) return NextResponse.json({ error: "Enter a valid preset" }, { status: 400 });
  try {
    const template = await getTenantTemplateForProduct(auth.context.tenantId, body.product_code);
    const catalog = new Map(template.template.fields.map((field) => [field.field_key, field]));
    const fields = choices(body.fields, new Set(catalog.keys())); const verification = choices(body.verification_fields, new Set(catalog.keys()));
    if (!fields || !verification) return NextResponse.json({ error: "A preset uses a field outside this product catalog" }, { status: 400 });
    if (!fields.some((field) => catalog.get(field.field_key)?.type === "phone")) return NextResponse.json({ error: "Phone is required for screening and cannot be removed" }, { status: 400 });
    const saved = await savePartnerFormPreset(auth.context.tenantId, { id: body.id as string | undefined, product_code: body.product_code, name: body.name, fields, verification_fields: verification, source_template_revision: template.assignment.definition_version, created_by: auth.context.userId });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_form_preset_saved", targetType: "partner_form_preset", targetId: saved.id, metadata: { partnerId, productCode: body.product_code, revision: saved.revision }, request });
    return NextResponse.json({ preset: saved }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save form preset" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params; const presetId = new URL(request.url).searchParams.get("preset_id");
  if (!UUID.test(partnerId) || !presetId || !UUID.test(presetId)) return NextResponse.json({ error: "Choose a preset" }, { status: 400 });
  try { await archivePartnerFormPreset(auth.context.tenantId, presetId); await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_form_preset_archived", targetType: "partner_form_preset", targetId: presetId, metadata: { partnerId }, request }); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not archive form preset" }, { status: 400 }); }
}

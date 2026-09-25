import { NextResponse, type NextRequest } from "next/server";

import { getTenantTemplateForProduct } from "@/lib/agentTemplates/service";
import { audit } from "@/lib/audit/log";
import type { LooseDb } from "@/lib/supabase/loose";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const owner = ["owner"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Choice = { field_key: string; is_required?: boolean; sort_order?: number };
type ProfileRow = { id: string; current_revision: number; scope: string };
type RevisionRow = {
  fields: Choice[];
  verification_fields: Choice[];
  source_template_revision: number;
  source_preset_id: string | null;
  source_preset_revision: number | null;
};
type SavedProfile = { profile_id: string; revision: number };

function clean(value: unknown, catalog: Map<string, { type: string }>): Choice[] | null {
  if (!Array.isArray(value)) return null;
  const fields = value.map((item) => item && typeof item === "object" && !Array.isArray(item) ? item as Choice : null).filter((item): item is Choice => Boolean(item)).map((item, index) => ({ field_key: item.field_key, is_required: item.is_required === true, sort_order: Number.isInteger(item.sort_order) ? item.sort_order : index }));
  return fields.length === value.length && fields.every((field) => typeof field.field_key === "string" && catalog.has(field.field_key)) ? fields : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner); if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params; const productCode = new URL(request.url).searchParams.get("product_code");
  if (!UUID.test(partnerId) || !productCode) return NextResponse.json({ error: "Choose a publisher and product" }, { status: 400 });
  try {
    const template = await getTenantTemplateForProduct(auth.context.tenantId, productCode); const db = getSupabaseServiceClient() as unknown as LooseDb;
    const profile = await db.from<ProfileRow>("partner_submission_profiles").select("id, current_revision, scope").eq("tenant_id", auth.context.tenantId).eq("partner_id", partnerId).eq("product_code", productCode).eq("scope", "publisher").is("subject_user_id", null).maybeSingle();
    if (profile.error) throw new Error(profile.error.message);
    const revision = profile.data ? await db.from<RevisionRow>("partner_submission_profile_revisions").select("fields, verification_fields, source_template_revision, source_preset_id, source_preset_revision").eq("profile_id", profile.data.id).eq("revision", profile.data.current_revision).maybeSingle() : { data: null, error: null };
    if (revision.error) throw new Error(revision.error.message);
    const defaults = template.template.fields.map((field, sort_order) => ({ field_key: field.field_key, is_required: field.is_required, sort_order }));
    return NextResponse.json({ catalog: template.template.fields, templateRevision: template.assignment.definition_version, profile: profile.data ? { ...profile.data, revision: revision.data } : null, effective: { fields: revision.data?.fields ?? defaults, verification_fields: revision.data?.verification_fields ?? [], source: profile.data ? "publisher" : "tenant_template" } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load form defaults" }, { status: 400 }); }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner, { write: true }); if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params; const body = await request.json().catch(() => null) as { product_code?: unknown; fields?: unknown; verification_fields?: unknown; source_preset_id?: unknown; source_preset_revision?: unknown } | null;
  if (!UUID.test(partnerId) || typeof body?.product_code !== "string") return NextResponse.json({ error: "Choose a publisher and product" }, { status: 400 });
  try {
    const template = await getTenantTemplateForProduct(auth.context.tenantId, body.product_code); const catalog = new Map(template.template.fields.map((field) => [field.field_key, field]));
    const fields = clean(body.fields, catalog); const verification = clean(body.verification_fields, catalog);
    if (!fields || !verification) return NextResponse.json({ error: "A selected field is not in this product catalog" }, { status: 400 });
    if (!fields.some((field) => catalog.get(field.field_key)?.type === "phone")) return NextResponse.json({ error: "Phone is required for screening and cannot be removed" }, { status: 400 });
    const db = getSupabaseServiceClient() as unknown as LooseDb;
    const { data, error } = await db.rpc<SavedProfile | SavedProfile[]>("save_partner_submission_profile_revision", { p_tenant_id: auth.context.tenantId, p_partner_id: partnerId, p_subject_user_id: null, p_scope: "publisher", p_product_code: body.product_code, p_fields: fields, p_verification_fields: verification, p_source_template_revision: template.assignment.definition_version, p_created_by: auth.context.userId });
    if (error || !data) throw new Error(error?.message ?? "Could not save form defaults"); const saved = (Array.isArray(data) ? data[0] : data) as SavedProfile | undefined;
    if (!saved) throw new Error("Could not save form defaults");
    if (body.source_preset_id && typeof body.source_preset_id === "string" && UUID.test(body.source_preset_id)) await db.from<RevisionRow>("partner_submission_profile_revisions").update({ source_preset_id: body.source_preset_id, source_preset_revision: Number.isInteger(body.source_preset_revision) ? body.source_preset_revision : null }).eq("profile_id", saved.profile_id).eq("revision", saved.revision);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_form_profile_saved", targetType: "partner_submission_profile", targetId: saved.profile_id, metadata: { partnerId, scope: "publisher", productCode: body.product_code, revision: saved.revision }, request });
    return NextResponse.json({ ok: true, profileId: saved.profile_id, revision: saved.revision });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save form defaults" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner, { write: true }); if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params; const productCode = new URL(request.url).searchParams.get("product_code");
  if (!UUID.test(partnerId) || !productCode) return NextResponse.json({ error: "Choose a publisher and product" }, { status: 400 });
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  const { error } = await db.from<ProfileRow>("partner_submission_profiles").delete().eq("tenant_id", auth.context.tenantId).eq("partner_id", partnerId).eq("product_code", productCode).eq("scope", "publisher").is("subject_user_id", null);
  if (error) return NextResponse.json({ error: "Could not restore tenant defaults" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

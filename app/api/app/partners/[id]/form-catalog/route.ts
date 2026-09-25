import { NextResponse, type NextRequest } from "next/server";

import { getTenantTemplateForProduct, updateTenantTemplateCopy } from "@/lib/agentTemplates/service";
import { audit } from "@/lib/audit/log";
import { TEMPLATE_FIELD_TYPES, TEMPLATE_KEY_PATTERN, type TemplateField } from "@/lib/templates/constants";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const owner = ["owner"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params;
  const body = await request.json().catch(() => null) as { product_code?: unknown; field?: Partial<TemplateField> } | null;
  const field = body?.field;
  if (!UUID.test(partnerId) || typeof body?.product_code !== "string" || !field || typeof field.field_key !== "string" || !TEMPLATE_KEY_PATTERN.test(field.field_key) || typeof field.label !== "string" || !field.label.trim() || !TEMPLATE_FIELD_TYPES.includes(field.type as TemplateField["type"])) return NextResponse.json({ error: "Enter a valid field key, label, and type" }, { status: 400 });
  try {
    const current = await getTenantTemplateForProduct(auth.context.tenantId, body.product_code);
    if (current.template.fields.some((item) => item.field_key === field.field_key)) return NextResponse.json({ error: "This field key already exists in the shared catalog" }, { status: 409 });
    const select = field.type === "single_select" || field.type === "multi_select";
    const options = Array.isArray(field.options) ? field.options.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
    if (select && !options.length) return NextResponse.json({ error: "Select fields need at least one option" }, { status: 400 });
    const nextField: TemplateField = { field_key: field.field_key, label: field.label.trim(), type: field.type as TemplateField["type"], is_required: field.is_required === true, options, sort_order: current.template.fields.length, help_text: typeof field.help_text === "string" ? field.help_text.trim() || null : null, validation: field.validation && typeof field.validation === "object" ? field.validation : {} };
    // Keep this field catalog-only. Partner profiles choose it explicitly; it is not injected
    // into the tenant's base form or every unconfigured partner form.
    await updateTenantTemplateCopy(auth.context.tenantId, current.tenant_template_id, { name: current.template.name, description: current.template.description, fields: [...current.template.fields, nextField], stages: current.template.stages, form_definition: current.template.form_definition });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_form_catalog_field_added", targetType: "tenant_template_field", targetId: `${current.tenant_template_id}:${nextField.field_key}`, metadata: { partnerId, productCode: body.product_code, fieldKey: nextField.field_key }, request });
    return NextResponse.json({ field: nextField }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add form field" }, { status: 400 }); }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params;
  const query = new URL(request.url).searchParams;
  const productCode = query.get("product_code");
  const fieldKey = query.get("field_key");
  const body = await request.json().catch(() => null) as { field?: Partial<TemplateField> } | null;
  const field = body?.field;
  if (!UUID.test(partnerId) || !productCode || !fieldKey || !field || typeof field.label !== "string" || !field.label.trim() || !TEMPLATE_FIELD_TYPES.includes(field.type as TemplateField["type"]))
    return NextResponse.json({ error: "Enter a valid field label and type" }, { status: 400 });
  try {
    const current = await getTenantTemplateForProduct(auth.context.tenantId, productCode);
    const existing = current.template.fields.find((item) => item.field_key === fieldKey);
    if (!existing) return NextResponse.json({ error: "Field not found" }, { status: 404 });
    if (existing.type === "phone" && field.type !== "phone")
      return NextResponse.json({ error: "Phone is required for screening and cannot change type" }, { status: 400 });
    const select = field.type === "single_select" || field.type === "multi_select";
    const options = Array.isArray(field.options)
      ? field.options.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
      : existing.options;
    if (select && !options.length) return NextResponse.json({ error: "Select fields need at least one option" }, { status: 400 });
    const nextField: TemplateField = {
      ...existing,
      label: field.label.trim(),
      type: field.type as TemplateField["type"],
      is_required: field.is_required === true,
      options,
      help_text: typeof field.help_text === "string" ? field.help_text.trim() || null : existing.help_text ?? null,
      validation: field.validation && typeof field.validation === "object" ? field.validation : existing.validation ?? {},
    };
    await updateTenantTemplateCopy(auth.context.tenantId, current.tenant_template_id, {
      name: current.template.name,
      description: current.template.description,
      fields: current.template.fields.map((item) => item.field_key === fieldKey ? nextField : item),
      stages: current.template.stages,
      form_definition: current.template.form_definition,
    });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_form_catalog_field_updated", targetType: "tenant_template_field", targetId: `${current.tenant_template_id}:${fieldKey}`, metadata: { partnerId, productCode, fieldKey }, request });
    return NextResponse.json({ field: nextField });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update form field" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("publisher_records", owner, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId } = await params;
  const query = new URL(request.url).searchParams;
  const productCode = query.get("product_code");
  const fieldKey = query.get("field_key");
  if (!UUID.test(partnerId) || !productCode || !fieldKey)
    return NextResponse.json({ error: "Choose a field to delete" }, { status: 400 });
  try {
    const current = await getTenantTemplateForProduct(auth.context.tenantId, productCode);
    const existing = current.template.fields.find((item) => item.field_key === fieldKey);
    if (!existing) return NextResponse.json({ error: "Field not found" }, { status: 404 });
    if (existing.type === "phone")
      return NextResponse.json({ error: "Phone is required for screening and cannot be deleted" }, { status: 400 });
    const formDefinition = {
      ...current.template.form_definition,
      sections: current.template.form_definition.sections.map((section) => ({
        ...section,
        fields: section.fields.filter((item) => item.field_key !== fieldKey),
      })),
    };
    await updateTenantTemplateCopy(auth.context.tenantId, current.tenant_template_id, {
      name: current.template.name,
      description: current.template.description,
      fields: current.template.fields.filter((item) => item.field_key !== fieldKey),
      stages: current.template.stages,
      form_definition: formDefinition,
    });
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.partner_form_catalog_field_deleted", targetType: "tenant_template_field", targetId: `${current.tenant_template_id}:${fieldKey}`, metadata: { partnerId, productCode, fieldKey }, request });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete form field" }, { status: 400 });
  }
}

import { NextResponse, type NextRequest } from "next/server";

import {
  getPartnerTemplateForProduct,
  getTenantTemplateForProduct,
} from "@/lib/agentTemplates/service";
import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const OWNER_ROLES = ["owner"] as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type FieldChoice = {
  field_key: string;
  is_required?: boolean;
  sort_order?: number;
  submission?: boolean;
  verification?: boolean;
};
type QueryResult = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  select: (columns: string) => Query;
  eq: (column: string, value: unknown) => Query;
  maybeSingle: () => Promise<QueryResult>;
  insert: (value: unknown) => Query;
  update: (value: unknown) => Query;
  delete: () => Query;
  single: () => Promise<QueryResult>;
};
type Db = { from: (table: string) => Query };

async function target(tenantId: string, partnerId: string, userId: string) {
  const db = getSupabaseServiceClient();
  const { data } = await db
    .from("partner_users")
    .select("user_id, role, partner_admin_user_id")
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .eq("user_id", userId)
    .maybeSingle<{
      user_id: string;
      role: "partner_admin" | "partner_user";
      partner_admin_user_id: string | null;
    }>();
  return data ?? null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const auth = await requireFeatureRole("publisher_records", OWNER_ROLES);
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId, userId } = await params;
  const productCode = new URL(request.url).searchParams.get("product_code");
  if (!UUID.test(partnerId) || !UUID.test(userId) || !productCode)
    return NextResponse.json(
      { error: "Choose a publisher, user, and product" },
      { status: 400 },
    );
  const membership = await target(auth.context.tenantId, partnerId, userId);
  if (!membership)
    return NextResponse.json(
      { error: "Partner user not found" },
      { status: 404 },
    );
  try {
    const template = await getTenantTemplateForProduct(
      auth.context.tenantId,
      productCode,
    );
    const scope = membership.role;
    const db = getSupabaseServiceClient() as unknown as Db;
    const profile = await db
      .from("partner_submission_profiles")
      .select("id, current_revision, scope")
      .eq("tenant_id", auth.context.tenantId)
      .eq("partner_id", partnerId)
      .eq("product_code", productCode)
      .eq("subject_user_id", userId)
      .eq("scope", scope)
      .maybeSingle();
    let revision: unknown = null;
    if (profile.data)
      revision = await db
        .from("partner_submission_profile_revisions")
        .select(
          "fields, verification_fields, source_template_revision, created_at",
        )
        .eq("profile_id", (profile.data as { id: string }).id)
        .eq(
          "revision",
          (profile.data as { current_revision: number }).current_revision,
        )
        .maybeSingle();
    const effective = await getPartnerTemplateForProduct(
      auth.context.tenantId,
      partnerId,
      userId,
      productCode,
    );
    const directRevision =
      (
        revision as {
          data?: { fields?: unknown; verification_fields?: unknown };
        } | null
      )?.data ?? null;
    const effectiveFields = effective.template.fields.map(
      (field, sort_order) => ({
        field_key: field.field_key,
        is_required: field.is_required,
        sort_order,
      }),
    );
    return NextResponse.json(
      {
        target: membership,
        catalog: template.template.fields,
        templateRevision: template.assignment.definition_version,
        profile: profile.data
          ? { ...(profile.data as object), revision: directRevision }
          : null,
        effective: {
          fields: effectiveFields,
          verification_fields: effective.verification_fields ?? [],
          source: effective.profile_source ?? "tenant_template",
          profile_id: effective.partner_submission_profile_id ?? null,
          revision: effective.profile_revision ?? null,
        },
        inheritance:
          membership.role === "partner_user"
            ? membership.partner_admin_user_id
              ? profile.data
                ? "partner_admin"
                : "partner_admin"
              : "unassigned"
            : profile.data
              ? "partner_admin"
              : "tenant_template",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load form profile",
      },
      { status: 400 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const auth = await requireFeatureRole("publisher_records", OWNER_ROLES, {
    write: true,
  });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId, userId } = await params;
  const body = (await request.json().catch(() => null)) as {
    product_code?: unknown;
    fields?: unknown;
    verification_fields?: unknown;
    source_preset_id?: unknown;
    source_preset_revision?: unknown;
  } | null;
  if (
    !UUID.test(partnerId) ||
    !UUID.test(userId) ||
    typeof body?.product_code !== "string" ||
    !Array.isArray(body.fields) ||
    !Array.isArray(body.verification_fields)
  )
    return NextResponse.json(
      { error: "Choose a publisher, user, product, and valid field lists" },
      { status: 400 },
    );
  const membership = await target(auth.context.tenantId, partnerId, userId);
  if (!membership)
    return NextResponse.json(
      { error: "Partner user not found" },
      { status: 404 },
    );
  try {
    const template = await getTenantTemplateForProduct(
      auth.context.tenantId,
      body.product_code,
    );
    const catalog = new Map(
      template.template.fields.map((field) => [field.field_key, field]),
    );
    const clean = (items: unknown[]): FieldChoice[] =>
      items.flatMap((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const value = item as FieldChoice;
        if (
          typeof value.field_key !== "string" ||
          !catalog.has(value.field_key)
        )
          return [];
        return [
          {
            field_key: value.field_key,
            is_required: value.is_required === true,
            sort_order: Number.isInteger(value.sort_order)
              ? value.sort_order
              : index,
            submission: value.submission !== false,
            verification: value.verification === true,
          },
        ];
      });
    const fields = clean(body.fields);
    const verification = clean(body.verification_fields);
    if (
      fields.length !== body.fields.length ||
      verification.length !== body.verification_fields.length
    )
      return NextResponse.json(
        { error: "A selected field is not in this product's shared template" },
        { status: 400 },
      );
    if (
      !fields.some((choice) => catalog.get(choice.field_key)?.type === "phone")
    )
      return NextResponse.json(
        { error: "Phone is required for screening and cannot be removed" },
        { status: 400 },
      );
    const { data: saved, error: saveError } =
      await getSupabaseServiceClient().rpc(
        "save_partner_submission_profile_revision",
        {
          p_tenant_id: auth.context.tenantId,
          p_partner_id: partnerId,
          p_subject_user_id: userId,
          p_scope: membership.role,
          p_product_code: body.product_code,
          p_fields: fields,
          p_verification_fields: verification,
          p_source_template_revision: template.assignment.definition_version,
          p_created_by: auth.context.userId,
        },
      );
    if (saveError || !saved)
      throw new Error(saveError?.message ?? "Could not publish form profile");
    const result = Array.isArray(saved)
      ? (saved[0] as { profile_id: string; revision: number })
      : (saved as unknown as { profile_id: string; revision: number });
    if (!result?.profile_id || !result.revision)
      throw new Error("Could not publish form profile");
    if (
      typeof body.source_preset_id === "string" &&
      UUID.test(body.source_preset_id) &&
      Number.isInteger(body.source_preset_revision)
    ) {
      const { error: presetMetadataError } = await (
        getSupabaseServiceClient() as unknown as Db
      )
        .from("partner_submission_profile_revisions")
        .update({
          source_preset_id: body.source_preset_id,
          source_preset_revision: body.source_preset_revision,
        })
        .eq("profile_id", result.profile_id)
        .eq("revision", result.revision);
      if (presetMetadataError) throw new Error(presetMetadataError.message);
    }
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.partner_form_profile_saved",
      targetType: "partner_submission_profile",
      targetId: result.profile_id,
      metadata: {
        partnerId,
        subjectUserId: userId,
        scope: membership.role,
        productCode: body.product_code,
        revision: result.revision,
      },
      request,
    });
    return NextResponse.json({
      ok: true,
      profileId: result.profile_id,
      revision: result.revision,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not save form profile",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const auth = await requireFeatureRole("publisher_records", OWNER_ROLES, {
    write: true,
  });
  if (auth instanceof NextResponse) return auth;
  const { id: partnerId, userId } = await params;
  const productCode = new URL(request.url).searchParams.get("product_code");
  if (!UUID.test(partnerId) || !UUID.test(userId) || !productCode)
    return NextResponse.json(
      { error: "Choose a publisher, user, and product" },
      { status: 400 },
    );
  const membership = await target(auth.context.tenantId, partnerId, userId);
  if (!membership)
    return NextResponse.json(
      { error: "Partner user not found" },
      { status: 404 },
    );
  try {
    const db = getSupabaseServiceClient() as unknown as Db;
    const deleted = await db
      .from("partner_submission_profiles")
      .delete()
      .eq("tenant_id", auth.context.tenantId)
      .eq("partner_id", partnerId)
      .eq("product_code", productCode)
      .eq("subject_user_id", userId)
      .eq("scope", membership.role);
    if (deleted.error) throw new Error(deleted.error.message);
    await audit({
      actorType: "tenant",
      actorId: auth.context.userId,
      action: "tenant.partner_form_profile_saved",
      targetType: "partner_submission_profile",
      targetId: `${partnerId}:${userId}:${productCode}`,
      metadata: {
        partnerId,
        subjectUserId: userId,
        scope: membership.role,
        productCode,
        restoredInheritedDefaults: true,
      },
      request,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not restore inherited defaults",
      },
      { status: 400 },
    );
  }
}

import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_TEMPLATES } from "@/lib/templates/permissions";
import { fetchTemplates } from "@/lib/templates/queries";
import { updateTemplateSchema } from "@/lib/templates/schemas";
import { saveTemplate } from "@/lib/templates/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_TEMPLATES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const body = await request.json().catch(() => null);

  // Availability is not content. Toggling it does not create a meaningless new schema version.
  if (body && Object.keys(body).length === 1 && typeof body.is_active === "boolean") {
    const { data: before } = await getSupabaseServiceClient().from("templates").select("id, name, is_active").eq("id", id).maybeSingle();
    if (!before) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const { data: updated, error } = await getSupabaseServiceClient().from("templates").update({ is_active: body.is_active }).eq("id", id).select("id, name, is_active, version").single();
    if (error) return NextResponse.json({ error: "Could not update the template" }, { status: 500 });
    if (before.is_active !== body.is_active) {
      await audit({ actorId: auth.session.sub, action: body.is_active ? "template.restored" : "template.archived", targetType: "template", targetId: id, metadata: { name: before.name }, request });
    }
    return NextResponse.json({ template: updated });
  }

  const parsed = updateTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid template" }, { status: 400 });
  try {
    const saved = await saveTemplate(id, parsed.data, auth.session.sub);
    await audit({ actorId: auth.session.sub, action: "template.version_created", targetType: "template", targetId: id, metadata: { name: parsed.data.name, product_code: parsed.data.product_code, version: saved.version }, request });
    return NextResponse.json({ template: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "template_not_found") return NextResponse.json({ error: "Template not found" }, { status: 404 });
    if (message === "product_not_found") return NextResponse.json({ error: "That product does not exist" }, { status: 400 });
    return NextResponse.json({ error: "Could not save the template" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_TEMPLATES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const { data: before } = await getSupabaseServiceClient().from("templates").select("id, name, is_active").eq("id", id).maybeSingle();
  if (!before) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (!before.is_active) return NextResponse.json({ template: before, archived: true });
  const { data: updated, error } = await getSupabaseServiceClient().from("templates").update({ is_active: false }).eq("id", id).select("id, name, is_active, version").single();
  if (error) return NextResponse.json({ error: "Could not archive the template" }, { status: 500 });
  await audit({ actorId: auth.session.sub, action: "template.archived", targetType: "template", targetId: id, metadata: { name: before.name }, request });
  return NextResponse.json({ template: updated, archived: true });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_TEMPLATES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const template = (await fetchTemplates()).find((item) => item.id === id);
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json({ template });
}

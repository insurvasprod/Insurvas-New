import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_TEMPLATES } from "@/lib/templates/permissions";
import { duplicateTemplate } from "@/lib/templates/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { z } from "zod";

const schema = z.object({ name: z.string().trim().min(1).max(120) });

/**
 * Copies a template's current version into a new template at version 1. Once migration
 * 20260925504000 is applied the copy is a draft (hidden from agencies); before it, the database
 * function still inserts it active. The response and the audit row say which one happened.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_TEMPLATES);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A copy name is required" }, { status: 400 });
  try {
    const copy = await duplicateTemplate(id, parsed.data.name, auth.session.sub);
    const { data: row } = await getSupabaseServiceClient().from("templates").select("is_active").eq("id", copy.id).maybeSingle();
    const state = row ? (row.is_active ? "published" : "draft") : null;
    await audit({ actorId: auth.session.sub, action: "template.duplicated", targetType: "template", targetId: copy.id, metadata: { source_template_id: id, name: parsed.data.name, version: copy.version, state }, request });
    return NextResponse.json({ template: { ...copy, state } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "template_not_found") return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json({ error: "Could not duplicate the template" }, { status: 500 });
  }
}

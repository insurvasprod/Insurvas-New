import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { CAN_MANAGE_TEMPLATES } from "@/lib/templates/permissions";
import { fetchTemplates } from "@/lib/templates/queries";
import { createTemplateSchema } from "@/lib/templates/schemas";
import { saveTemplate } from "@/lib/templates/service";

export async function GET(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_TEMPLATES);
  if (auth instanceof NextResponse) return auth;
  try {
    const templates = await fetchTemplates({ includeArchived: request.nextUrl.searchParams.get("picker") !== "1" });
    return NextResponse.json({ templates });
  } catch {
    return NextResponse.json({ error: "Could not load templates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_TEMPLATES);
  if (auth instanceof NextResponse) return auth;
  const parsed = createTemplateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid template" }, { status: 400 });
  try {
    const saved = await saveTemplate(null, parsed.data, auth.session.sub);
    await audit({ actorId: auth.session.sub, action: "template.created", targetType: "template", targetId: saved.id, metadata: { name: parsed.data.name, product_code: parsed.data.product_code, version: saved.version }, request });
    return NextResponse.json({ template: { id: saved.id, version: saved.version } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "product_not_found") return NextResponse.json({ error: "That product does not exist" }, { status: 400 });
    return NextResponse.json({ error: "Could not create the template" }, { status: 500 });
  }
}

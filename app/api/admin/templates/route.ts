import { NextResponse, type NextRequest } from "next/server";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { createDraftTemplate } from "@/lib/templates/drafts";
import { CAN_MANAGE_TEMPLATES } from "@/lib/templates/permissions";
import { fetchTemplates } from "@/lib/templates/queries";
import { createTemplateSchema } from "@/lib/templates/schemas";
import { saveTemplate } from "@/lib/templates/service";
import { templateDraftsSupported } from "@/lib/templates/usage";

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

/**
 * Creates a template. `status: "draft"` (optional; default "published", which is what every caller
 * before the drafts work sent) creates it hidden from tenants until it is published.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_MANAGE_TEMPLATES);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  const status = body && typeof body === "object" && "status" in body ? (body as { status: unknown }).status : "published";
  if (status !== "draft" && status !== "published") {
    return NextResponse.json({ error: "Status must be draft or published" }, { status: 400 });
  }
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid template" }, { status: 400 });
  try {
    if (status === "draft" && !(await templateDraftsSupported())) {
      return NextResponse.json({ error: "This setting needs a database update that has not been applied yet." }, { status: 503 });
    }
    const saved = status === "draft" ? await createDraftTemplate(parsed.data, auth.session.sub) : await saveTemplate(null, parsed.data, auth.session.sub);
    await audit({ actorId: auth.session.sub, action: "template.created", targetType: "template", targetId: saved.id, metadata: { name: parsed.data.name, product_code: parsed.data.product_code, version: saved.version, state: status }, request });
    return NextResponse.json({ template: { id: saved.id, version: saved.version, state: status } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "product_not_found") return NextResponse.json({ error: "That product does not exist" }, { status: 400 });
    return NextResponse.json({ error: "Could not create the template" }, { status: 500 });
  }
}

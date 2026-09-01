import { NextResponse, type NextRequest } from "next/server";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { previewTemplateApplication } from "@/lib/agentTemplates/service";

export async function POST(request: NextRequest) {
  const auth = await requireFeatureRole("book_of_business", ["owner"]);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null) as { template_id?: string; template_version?: number } | null;
  const version = typeof body?.template_version === "number" ? body.template_version : 0;
  if (!body?.template_id || !Number.isInteger(version) || version < 1) return NextResponse.json({ error: "Choose a valid template" }, { status: 400 });
  try { return NextResponse.json({ preview: await previewTemplateApplication(auth.context.tenantId, body.template_id, version) }); }
  catch (error) { const message = error instanceof Error ? error.message : "Could not preview template"; return NextResponse.json({ error: message }, { status: message.includes("does not include") ? 403 : 400 }); }
}

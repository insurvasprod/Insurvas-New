import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import { BookImportError, loadGuidance, saveGuidance } from "@/lib/ingestion/bookImport";
import { layoutAdmin } from "@/lib/ingestion/layoutAdminHttp";
import { isRecordUuid } from "@/lib/ingestion/path";

/**
 * LA-4.10 (Notion sprint) · where each carrier's policy file lives in its portal, in plain words —
 * the platform's content, edited here without a deploy (carrier-library access). Blank clears it.
 */
const text = (max: number) => z.string().max(max).nullable();
const body = z.object({ carrier_id: z.string().refine(isRecordUuid, "Choose the carrier."), where_in_portal: text(1000), report_name: text(200), format_hint: text(200), notes: text(2000) }).strict();

export async function GET() {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  try {
    return NextResponse.json(await loadGuidance(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[carrier-guidance]", error);
    return NextResponse.json({ error: "Could not load the guidance." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the guidance and try again." }, { status: 400 });
  try {
    const done = await saveGuidance(scope.adminId, parsed.data.carrier_id, { whereInPortal: parsed.data.where_in_portal, reportName: parsed.data.report_name, formatHint: parsed.data.format_hint, notes: parsed.data.notes });
    await audit({ actorType: "admin", actorId: scope.adminId, action: "carrier_guidance.saved", targetType: "carrier", targetId: parsed.data.carrier_id, metadata: { result: done }, request });
    return NextResponse.json({ ok: true, result: done });
  } catch (error) {
    if (error instanceof BookImportError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[carrier-guidance]", error);
    return NextResponse.json({ error: "The guidance could not be saved." }, { status: 500 });
  }
}

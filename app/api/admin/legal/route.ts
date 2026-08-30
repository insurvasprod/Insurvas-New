import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { LEGAL_DOC_TYPES } from "@/lib/legal/constants";
import { audit } from "@/lib/audit/log";

// Publishing terms binds every customer. Kept to super_admin rather than the broader config role:
// a platform_config admin can change how the product behaves, not what people are agreeing to.
const CAN_PUBLISH_LEGAL = ["super_admin"] as const;

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("publish"),
    docType: z.enum(LEGAL_DOC_TYPES),
    title: z.string().trim().min(3).max(160),
    content: z.string().trim().min(50, "The document text is too short to be a real legal document"),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give an effective date"),
    changeSummary: z.string().trim().max(2000).optional(),
    requiresReacceptance: z.boolean(),
  }),
  // The escape hatch. A mistaken publish otherwise locks every paying customer out of the product
  // with no recovery short of editing the database by hand.
  z.object({
    action: z.literal("clear_reacceptance"),
    documentId: z.string().uuid(),
    reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
  }),
]);

export async function POST(request: NextRequest) {
  const auth = await requireAdminRole(CAN_PUBLISH_LEGAL);
  if (auth instanceof NextResponse) return auth;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const input = parsed.data;

  if (input.action === "publish") {
    const { data, error } = await supabase.rpc("publish_legal_document", {
      p_doc_type: input.docType,
      p_title: input.title,
      p_content: input.content,
      p_effective_date: input.effectiveDate,
      p_change_summary: input.changeSummary ?? null,
      p_requires_reacceptance: input.requiresReacceptance,
      p_published_by: auth.session.sub,
    });

    if (error) {
      console.error("[legal] publish failed", error);
      return NextResponse.json({ error: error.message }, { status: 409 });
    }

    const row = Array.isArray(data) ? data[0] : data;
    await audit({
      actorId: auth.session.sub,
      action: "legal_document.published",
      targetType: "legal_document",
      targetId: row.id,
      metadata: {
        docType: input.docType,
        version: row.version,
        requiresReacceptance: input.requiresReacceptance,
      },
      request,
    });

    return NextResponse.json({ ok: true, version: row.version, id: row.id });
  }

  const { error } = await supabase.rpc("clear_reacceptance_requirement", {
    p_document_id: input.documentId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 409 });

  await audit({
    actorId: auth.session.sub,
    action: "legal_document.reacceptance_cleared",
    targetType: "legal_document",
    targetId: input.documentId,
    reason: input.reason,
    request,
  });

  return NextResponse.json({ ok: true });
}

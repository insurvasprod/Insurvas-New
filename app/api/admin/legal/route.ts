import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { LEGAL_DOC_TYPES } from "@/lib/legal/constants";
import { audit } from "@/lib/audit/log";
import {
  countEligibleUsers,
  discardLegalDraft,
  LegalConflictError,
  LegalSchemaPendingError,
  publishLegalDraft,
  saveLegalDraft,
} from "@/lib/legal/admin";

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
  // Unpublished drafts (20260924363000). A draft may be short or unfinished — the 50-character floor
  // applies when it is published, not while it is being written. `expectedUpdatedAt` is the draft as
  // this admin last saw it (null: there was none), so two editors cannot overwrite each other.
  z.object({
    action: z.literal("save_draft"),
    docType: z.enum(LEGAL_DOC_TYPES),
    title: z.string().trim().min(3, "Give the document a title of at least 3 characters").max(160),
    content: z.string().max(200_000, "The document text is too long"),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Give an effective date"),
    changeSummary: z.string().trim().max(2000).optional(),
    requiresReacceptance: z.boolean(),
    expectedUpdatedAt: z.string().min(1).nullable(),
  }),
  z.object({
    action: z.literal("discard_draft"),
    docType: z.enum(LEGAL_DOC_TYPES),
    expectedUpdatedAt: z.string().min(1),
  }),
  // Publishes the SAVED draft — never text sent in this request — as `expectedVersion`. Refused when
  // someone published in between or the draft changed since the page loaded.
  z.object({
    action: z.literal("publish_draft"),
    docType: z.enum(LEGAL_DOC_TYPES),
    expectedVersion: z.number().int().min(1),
    expectedUpdatedAt: z.string().min(1),
  }),
]);

/**
 * The live count the publish confirmation states: users a material publish would stop right now.
 * Read when the dialog opens rather than trusted from page load.
 */
export async function GET() {
  const auth = await requireAdminRole(CAN_PUBLISH_LEGAL);
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json({ eligibleUsers: await countEligibleUsers() });
  } catch (error) {
    console.error("[legal] eligible count failed", error);
    return NextResponse.json({ error: "Could not count the users this would affect" }, { status: 500 });
  }
}

function draftFailure(error: unknown) {
  if (error instanceof LegalSchemaPendingError) return NextResponse.json({ error: error.message }, { status: 503 });
  if (error instanceof LegalConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  console.error("[legal] draft write failed", error);
  return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save" }, { status: 500 });
}

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

  if (input.action === "save_draft") {
    try {
      const draft = await saveLegalDraft(
        {
          docType: input.docType,
          title: input.title,
          content: input.content,
          effectiveDate: input.effectiveDate,
          changeSummary: input.changeSummary ? input.changeSummary : null,
          requiresReacceptance: input.requiresReacceptance,
        },
        input.expectedUpdatedAt,
        auth.session.sub,
      );
      await audit({
        actorId: auth.session.sub,
        action: "legal_document.draft_saved",
        targetType: "legal_document_draft",
        targetId: input.docType,
        metadata: {
          docType: input.docType,
          created: input.expectedUpdatedAt === null,
          contentLength: input.content.length,
          requiresReacceptance: input.requiresReacceptance,
        },
        request,
      });
      return NextResponse.json({ ok: true, draft });
    } catch (error) {
      return draftFailure(error);
    }
  }

  if (input.action === "discard_draft") {
    try {
      await discardLegalDraft(input.docType, input.expectedUpdatedAt);
      await audit({
        actorId: auth.session.sub,
        action: "legal_document.draft_discarded",
        targetType: "legal_document_draft",
        targetId: input.docType,
        metadata: { docType: input.docType },
        request,
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      return draftFailure(error);
    }
  }

  if (input.action === "publish_draft") {
    let row: Awaited<ReturnType<typeof publishLegalDraft>>;
    try {
      row = await publishLegalDraft(input.docType, input.expectedVersion, input.expectedUpdatedAt, auth.session.sub);
    } catch (error) {
      return draftFailure(error);
    }
    await audit({
      actorId: auth.session.sub,
      action: "legal_document.published",
      targetType: "legal_document",
      targetId: row.id,
      metadata: {
        docType: input.docType,
        version: row.version,
        requiresReacceptance: row.requires_reacceptance,
        fromDraft: true,
      },
      request,
    });
    return NextResponse.json({ ok: true, version: row.version, id: row.id, requiresReacceptance: row.requires_reacceptance });
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

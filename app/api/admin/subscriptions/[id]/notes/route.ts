import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { audit } from "@/lib/audit/log";
import type { AuditAction } from "@/lib/audit/actions";
import { CAN_MANAGE_SUBSCRIPTIONS } from "@/lib/subscriptions/permissions";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * POST /api/admin/subscriptions/[id]/notes — a note on a customer's billing, written from the subscription's sheet
 * on Admin › Subscriptions (billing-r2 screen 2). Same roles as every subscription action (CAN_MANAGE_SUBSCRIPTIONS).
 * Append-only (subscription_billing_notes, 20261117410000); answers 503 until that table exists.
 */

// Not yet in lib/audit/actions.ts (owned elsewhere); the integrator adds it with the label "Billing note added".
const NOTE_ADDED: AuditAction = "subscription.note_added";

const schema = z.object({ body: z.string().trim().min(1, "Write the note first").max(2000, "Keep a note under 2,000 characters") });

function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_MANAGE_SUBSCRIPTIONS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notes table is not in the generated types yet
  const db = getSupabaseServiceClient() as any;
  const sub = await db.from("subscriptions").select("id, tenant_id").eq("id", id).maybeSingle();
  if (sub.error) return NextResponse.json({ error: "Could not read the subscription" }, { status: 500 });
  if (!sub.data) return NextResponse.json({ error: "No such subscription" }, { status: 404 });

  const insert = await db
    .from("subscription_billing_notes")
    .insert({ tenant_id: sub.data.tenant_id, subscription_id: id, body: parsed.data.body, author_id: auth.session.sub })
    .select("id, created_at")
    .single();
  if (insert.error) {
    if (isMissingRelation(insert.error)) return NextResponse.json({ error: "Notes need a database update before they can be saved." }, { status: 503 });
    console.error("[admin/subscriptions] note insert failed:", insert.error.message);
    return NextResponse.json({ error: "The note could not be saved" }, { status: 500 });
  }

  await audit({
    actorId: auth.session.sub,
    action: NOTE_ADDED,
    targetType: "subscription",
    targetId: id,
    metadata: { tenantId: sub.data.tenant_id, noteId: insert.data.id, length: parsed.data.body.length },
    request,
  });
  return NextResponse.json({ ok: true, id: insert.data.id, createdAt: insert.data.created_at });
}

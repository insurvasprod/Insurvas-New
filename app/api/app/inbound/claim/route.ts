import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { announceTransferClaim } from "@/lib/transferInbox/service";
import { languageRefusal } from "@/lib/transferInbox/release";

const bodySchema = z.object({ work_item_id: z.string().uuid() }).strict();

export async function POST(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"], { write: true });
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid transfer to claim" }, { status: 400 });

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("claim_transfer_lead", {
    p_tenant_id: auth.context.tenantId,
    p_work_item_id: parsed.data.work_item_id,
    p_user_id: auth.context.userId,
    p_owner_role: auth.context.role,
  });
  if (error) {
    if (error.message === "ALREADY_CLAIMED") {
      const claimedBy = error.details && /^[0-9a-f-]{36}$/i.test(error.details) ? error.details : null;
      let ownerName = "another agent";
      if (claimedBy) {
        const owner = await supabase.from("users").select("name").eq("id", claimedBy).maybeSingle();
        ownerName = owner.data?.name ?? ownerName;
      }
      return NextResponse.json({ error: `This transfer was already claimed by ${ownerName}.`, code: "already_claimed", claimed_by: claimedBy }, { status: 409 });
    }
    if (error.message === "WORK_ITEM_NOT_FOUND") return NextResponse.json({ error: "That transfer is no longer available." }, { status: 404 });
    // LA-1.14-10 (20260925709860): the caller asked for a language this agent does not list.
    if (error.message === "LANGUAGE_NOT_SPOKEN") return NextResponse.json({ error: languageRefusal(error.details), code: "language_not_spoken", language: error.details ?? null }, { status: 409 });
    if (error.message === "ROLE_NOT_ALLOWED") return NextResponse.json({ error: "Your role cannot claim transfers.", code: "role_not_allowed" }, { status: 403 });
    console.error("[claim] claim_transfer_lead failed", error.code, error.message, error.details);
    return NextResponse.json({ error: "Could not claim this transfer" }, { status: 500 });
  }

  // Partner card + audit row, shared with Claim next so the two claim paths cannot drift.
  const { chatPosted } = await announceTransferClaim({ tenantId: auth.context.tenantId, userId: auth.context.userId, role: auth.context.role, workItemId: parsed.data.work_item_id, claim: data, request });
  return NextResponse.json({ claim: data, chatPosted });
}

import { NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getTransferInbox, postPartnerClaimMessage } from "@/lib/transferInbox/service";

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
    if (error.message === "ROLE_NOT_ALLOWED") return NextResponse.json({ error: "Your role cannot claim transfers.", code: "role_not_allowed" }, { status: 403 });
    return NextResponse.json({ error: "Could not claim this transfer" }, { status: 500 });
  }

  const inbox = await getTransferInbox(auth.context.tenantId, { status: "all" }, auth.context.userId, auth.context.role);
  const item = inbox.items.find((candidate) => candidate.id === parsed.data.work_item_id);
  let chatPosted = true;
  try {
    const isBuffer = auth.context.role === "assistant";
    await postPartnerClaimMessage(auth.context.tenantId, parsed.data.work_item_id, auth.context.userId, item?.customer ?? "Customer", isBuffer
      ? { eventKey: `buffer-claim:${parsed.data.work_item_id}`, message: `${item?.customer ?? "Customer"} is connected to the buffer agent` }
      : undefined);
  } catch (chatError) {
    chatPosted = false;
    console.error("Partner claim message failed after claim", chatError);
    await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.transfer_claim_chat_failed", targetType: "lead_queue", targetId: parsed.data.work_item_id, reason: chatError instanceof Error ? chatError.message : "Unknown chat error", request }).catch(() => undefined);
  }
  await audit({ actorType: "tenant", actorId: auth.context.userId, action: "tenant.transfer_claimed", targetType: "lead_queue", targetId: parsed.data.work_item_id, metadata: { activeCallId: (data as { active_call_id?: string })?.active_call_id ?? null, verificationSessionId: (data as { verification_session_id?: string })?.verification_session_id ?? null, chatPosted }, request });
  return NextResponse.json({ claim: data, chatPosted });
}

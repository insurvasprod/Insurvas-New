import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { guardLead } from "@/lib/agency/guards";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { cardTitle, parsePartnerMessage } from "@/lib/partnerChat/cards";

/** The most a lead's conversation shows; older partner messages stay in Partner chat. */
const LIMIT = 200;

/**
 * The partner side of a lead's Conversation tab (Module 1 simplified, 2026-10-25): what the partner
 * and the system said about THIS lead in the partner's channel — the automatic cards (connected,
 * outcome, …) and replies posted against the lead's transfer. A shared note is already a note on the
 * lead, so its copy in the channel (event_key `lead-note:…`) is left out rather than shown twice.
 *
 * The gate is Partner chat's: the inbound feature, owner or producer; and the lead's own (AG-0.5:
 * another producer's lead is a 404). Read-only.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const leadId = (await params).id;
  const hidden = await guardLead(auth.context, leadId);
  if (hidden) return hidden;
  try {
    const db = getSupabaseServiceClient();
    const tenantId = auth.context.tenantId;
    const items = await db.from("lead_queue").select("id").eq("tenant_id", tenantId).eq("lead_id", leadId);
    if (items.error) throw new Error(`Could not read the lead's transfers: ${items.error.message}`);
    const workItemIds = (items.data ?? []).map((row) => row.id as string);
    if (!workItemIds.length) return NextResponse.json({ messages: [] }, { headers: { "Cache-Control": "no-store" } });

    const read = await db
      .from("partner_messages")
      .select("id, channel_id, partner_id, work_item_id, message, message_kind, card_type, card_payload, created_by, created_at, event_key")
      .eq("tenant_id", tenantId)
      .in("work_item_id", workItemIds)
      .order("created_at", { ascending: false })
      .limit(LIMIT);
    if (read.error) throw new Error(`Could not read the partner messages: ${read.error.message}`);
    const rows = (read.data ?? []).filter((row) => !(typeof row.event_key === "string" && row.event_key.startsWith("lead-note:")));

    // Who wrote each message: a name, and whether they are the partner's people or the agency's.
    const authorIds = [...new Set(rows.map((row) => row.created_by).filter((id): id is string => typeof id === "string"))];
    const partnerIds = [...new Set(rows.map((row) => row.partner_id).filter((id): id is string => typeof id === "string"))];
    const [users, partnerUsers] = await Promise.all([
      authorIds.length ? db.from("users").select("id, name").in("id", authorIds) : Promise.resolve({ data: [], error: null }),
      authorIds.length && partnerIds.length ? db.from("partner_users").select("user_id").eq("tenant_id", tenantId).in("partner_id", partnerIds).in("user_id", authorIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (users.error) throw new Error(`Could not read the authors: ${users.error.message}`);
    if (partnerUsers.error) throw new Error(`Could not read the partner's users: ${partnerUsers.error.message}`);
    const names = new Map(((users.data ?? []) as Array<{ id: string; name: string | null }>).map((user) => [user.id, user.name ?? "Someone"]));
    const fromPartner = new Set(((partnerUsers.data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id));

    const messages = rows.flatMap((row) => {
      const parsed = parsePartnerMessage({ ...row, attachments: [] });
      if (!parsed) return [];
      const system = parsed.messageKind === "system_card";
      return [{
        id: parsed.id,
        body: parsed.message,
        title: system ? cardTitle(parsed) : null,
        system,
        author: system ? null : parsed.createdBy ? names.get(parsed.createdBy) ?? "Someone" : null,
        fromPartner: !system && parsed.createdBy !== null && fromPartner.has(parsed.createdBy),
        createdAt: parsed.createdAt,
      }];
    });
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load the conversation" }, { status: 500 });
  }
}

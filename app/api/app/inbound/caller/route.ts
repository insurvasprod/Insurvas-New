import { NextResponse } from "next/server";
import { z } from "zod";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { scopeFor } from "@/lib/agency/visibility";
import { guardWorkItem } from "@/lib/transferInbox/scope";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { listLeadNotes } from "@/lib/leadNotes/service";
import { getLeadRecord } from "@/lib/leadWorkspace/record";

const workItemSchema = z.string().uuid();

/**
 * Inbound step 2, Transfer check (owner 2026-10-28): what we already know about a caller before the
 * agent speaks to them — the lead's notes, how many times we have called them and how the last call
 * ended, and how many times they have been transferred in. Read-only, with Verification's gate: the
 * same people can open the call, and another producer's transfer answers 404 in an agency. Each part
 * is best-effort, so a missing one never stops the call.
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("inbound_transfers", ["owner", "producer", "assistant"], { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = workItemSchema.safeParse(new URL(request.url).searchParams.get("work_item_id"));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid transfer" }, { status: 400 });
  const hidden = await guardWorkItem(auth.context, parsed.data, await scopeFor(auth.context));
  if (hidden) return hidden;

  const tenantId = auth.context.tenantId;
  const db = getSupabaseServiceClient();
  const item = await db.from("lead_queue").select("lead_id").eq("tenant_id", tenantId).eq("id", parsed.data).maybeSingle();
  if (item.error || !item.data?.lead_id) return NextResponse.json({ error: "That transfer could not be found." }, { status: 404 });
  const leadId = item.data.lead_id as string;

  const [notes, record, transfers] = await Promise.all([
    listLeadNotes(tenantId, leadId).catch(() => null),
    getLeadRecord(tenantId, leadId).catch(() => null),
    db.from("lead_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("lead_id", leadId),
  ]);
  const placed = record?.attempts.filter((attempt) => attempt.dialled) ?? null;
  return NextResponse.json({
    leadId,
    notes: notes?.filter((note) => note.body).slice(0, 20).map((note) => ({ id: note.id, body: note.body, author: note.author.name, createdAt: note.createdAt })) ?? null,
    calls: placed ? { count: placed.length, last: placed[0] ? { at: placed[0].at, outcome: placed[0].outcome, by: placed[0].by } : null } : null,
    transfers: transfers.error ? null : transfers.count ?? 0,
  }, { headers: { "Cache-Control": "no-store" } });
}

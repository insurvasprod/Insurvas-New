import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit/log";
import { importBatchState } from "@/lib/agentTemplates/importPreflight";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";

/**
 * Lead sources › Review clean-up (owner 2026-10-29): one staged file.
 *
 *   GET     whether the batch is still waiting (staged / screening), already imported, or gone. The
 *           rail asks it for the files this tab holds, so a discarded or imported file stops being
 *           counted under Review.
 *   DELETE  "Discard this file": a batch still in 'processing' becomes 'failed' with who discarded
 *           it. Nothing else is touched — the status filter on the write means a committed batch can
 *           never be discarded, even in a race with its own import. No lead row exists for a staged
 *           file, so nothing else needs undoing. The same file can be staged again later (a failed
 *           batch is re-staged onto the same row by preflightImport).
 *
 * Same feature, roles and agency rule as the review it belongs to (preflight route). No money.
 */
const LEAD_IMPORT_ROLES = ["owner", "producer", "assistant"] as const;

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  update(value: unknown): Query;
};
type Db = { from(table: string): Query };

// Named and shaped like the other lead-import routes' helper, so the read-only-plan audit
// (lib/billing/selfService.test.mjs) recognises that a write refuses a paused or cancelled account.
async function context(write = false) {
  const auth = await requireFeatureRole("lead_import", LEAD_IMPORT_ROLES, { write, prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const refused = await refuseNarrowInAgency(auth.context, "Lead import");
  if (refused) return refused;
  return auth;
}

const validId = (id: string) => z.string().uuid().safeParse(id).success;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await context(false);
  if (auth instanceof NextResponse) return auth;
  const id = (await params).id;
  if (!validId(id)) return NextResponse.json({ state: "missing" }, { headers: { "Cache-Control": "no-store" } });
  const state = await importBatchState(auth.context.tenantId, id);
  return NextResponse.json({ state }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await context(true);
  if (auth instanceof NextResponse) return auth;
  const id = (await params).id;
  if (!validId(id)) return NextResponse.json({ error: "Choose a valid file" }, { status: 400 });
  const tenantId = auth.context.tenantId;
  const db = getSupabaseServiceClient() as unknown as Db;

  const users = await db.from("users").select("name, email").eq("id", auth.context.userId);
  const person = Array.isArray(users.data) ? (users.data[0] as { name?: string | null; email?: string | null } | undefined) : undefined;
  const who = person?.name?.trim() || person?.email || "a team member";

  // Only a batch still waiting for its decision. A completed (imported) or already failed batch is
  // left exactly as it is.
  const discarded = await db
    .from("agent_lead_import_batches")
    .update({ status: "failed", error_message: `Discarded by ${who}` })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .eq("status", "processing")
    .select("id");
  if (discarded.error) return NextResponse.json({ error: "Could not discard this file" }, { status: 500 });
  if (!Array.isArray(discarded.data) || discarded.data.length === 0) {
    const state = await importBatchState(tenantId, id);
    if (state === "committed") return NextResponse.json({ error: "This file was already imported, so it cannot be discarded.", state }, { status: 409 });
    return NextResponse.json({ error: "This file is not waiting for review any more.", state }, { status: 404 });
  }

  await audit({
    actorType: "tenant", actorId: auth.context.userId, action: "tenant.lead_import_discarded",
    targetType: "agent_lead_import_batch", targetId: id, metadata: { discardedBy: who }, request,
  });
  return NextResponse.json({ discarded: id });
}

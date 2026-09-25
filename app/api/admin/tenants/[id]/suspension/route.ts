import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminRole } from "@/lib/adminAuth/requireAdminRole";
import { CAN_SUSPEND_TENANTS } from "@/lib/tenants/permissions";
import {
  statusAfterUnsuspend,
  suspensionRefusal,
  SUSPENSION_REASON_MAX,
  validateSuspensionInput,
} from "@/lib/tenants/suspension";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { audit } from "@/lib/audit/log";

const bodySchema = z
  .object({
    action: z.enum(["suspend", "unsuspend"]),
    // Length is checked by validateSuspensionInput so the message is the one the dialog shows.
    reason: z.string().max(SUSPENSION_REASON_MAX * 2),
    confirmName: z.string().max(400).optional(),
  })
  .strict();

/**
 * Suspend or unsuspend an agency (decision 4). super_admin only.
 *
 * Suspending changes one thing: `tenants.status`. The session guards on the agent and partner
 * planes read it on every request, so everyone in the agency is signed out on their next request
 * and refused at sign-in. Nothing else is touched — the subscription, invoices, billing crons and
 * the agency's data carry on exactly as before, which is what makes Unsuspend a clean undo.
 *
 * The write is conditional on the state the admin saw (`eq("status", from)`), so two admins acting
 * at once cannot both succeed, and it is undone if its audit row cannot be written — a suspension
 * with no record of who did it, or why, must not stand.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminRole(CAN_SUSPEND_TENANTS);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose suspend or unsuspend and give a reason." }, { status: 400 });
  }
  const { action } = parsed.data;

  const supabase = getSupabaseServiceClient();
  const { data: tenant, error: readError } = await supabase
    .from("tenants")
    .select("id, name, status, suspended_at")
    .eq("id", id)
    .maybeSingle<{ id: string; name: string; status: string; suspended_at: string | null }>();
  if (readError) return NextResponse.json({ error: "Could not read this agency. Nothing was changed." }, { status: 503 });
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const refusal = suspensionRefusal(tenant.status, action);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 409 });

  const input = validateSuspensionInput(parsed.data, tenant.name);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const from = tenant.status as "active" | "provisioning" | "suspended";
  let to: "active" | "provisioning" | "suspended" = "suspended";
  if (action === "unsuspend") {
    // Back to the state it was suspended from, as the suspend row recorded it.
    const { data: last } = await supabase
      .from("audit_log")
      .select("metadata")
      .eq("action", "tenant.suspended")
      .eq("target_id", id)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle<{ metadata: { status?: { from?: unknown } } | null }>();
    to = statusAfterUnsuspend(last?.metadata?.status?.from);
  }

  const suspendedAt = action === "suspend" ? new Date().toISOString() : null;
  const { data: changed, error: writeError } = await supabase
    .from("tenants")
    .update({ status: to, suspended_at: suspendedAt })
    .eq("id", id)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (writeError) return NextResponse.json({ error: "Could not change this agency's state. Nothing was changed." }, { status: 500 });
  if (!changed) {
    return NextResponse.json({ error: "This agency changed while you were looking at it. Reload and try again." }, { status: 409 });
  }

  try {
    await audit({
      actorId: auth.session.sub,
      action: action === "suspend" ? "tenant.suspended" : "tenant.unsuspended",
      targetType: "tenant",
      targetId: id,
      reason: input.reason,
      metadata: { name: tenant.name, status: { from, to }, suspendedAt },
      request,
    });
  } catch {
    // Put it back exactly as it was. Best effort: if this fails too, the error below still tells
    // the admin not to trust what they see.
    await supabase.from("tenants").update({ status: from, suspended_at: tenant.suspended_at }).eq("id", id).eq("status", to);
    return NextResponse.json({ error: "Could not record this in the audit log, so it was not applied. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: to });
}

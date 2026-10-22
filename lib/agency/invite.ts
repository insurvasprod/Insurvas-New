import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AGENCY_INVITE_TTL_MS, bandBlock } from "./constants";

/**
 * AG-0.6 · the agency branch of the ONE invite flow (POST /api/app/team, LA-8.6). Individual plans never
 * reach this; the route sends only agency-audience tenants here.
 *
 * Differences from a solo agent's invite, each from the spec:
 *   · a member role may be an agency title (admin, manager);
 *   · an email that already has an Insurvas account in ANOTHER tenant is invited, not refused (D7);
 *   · a producer row exists from the moment of the invite (status 'invited');
 *   · the link is valid 7 days;
 *   · a full band answers with the band it needs and its price.
 */

type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

export type AgencyInviteResult =
  | { ok: true; userId: string; producerId: string | null; existing: boolean; expiresAt: Date }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function inviteAgencyMember(input: {
  tenantId: string;
  actorId: string;
  name: string;
  email: string;
  memberRole: string;
  tokenHash: string;
  maxBufferSeats: number | null;
}): Promise<AgencyInviteResult> {
  const supabase = getSupabaseServiceClient();
  const expiresAt = new Date(Date.now() + AGENCY_INVITE_TTL_MS);

  const { data: existing } = await supabase.from("users").select("id, status").ilike("email", input.email).maybeSingle<{ id: string; status: string }>();
  let userId = existing?.id ?? null;
  let createdAuth = false;
  if (!userId) {
    const { data: authUser, error } = await supabase.auth.admin.createUser({
      email: input.email,
      password: `Invite-${crypto.randomUUID()}-Only!`,
      email_confirm: false,
      user_metadata: { name: input.name, full_name: input.name, display_name: input.name },
    });
    if (error || !authUser.user) {
      return { ok: false, status: error?.code === "email_exists" ? 409 : 500, body: { error: error?.code === "email_exists" ? "This email is already registered" : "Could not invite this teammate" } };
    }
    userId = authUser.user.id;
    createdAuth = true;
  }

  const { data, error } = await (supabase as unknown as Rpc).rpc("agency_invite_member", {
    p_tenant_id: input.tenantId,
    p_user_id: userId,
    p_existing: Boolean(existing),
    p_name: input.name,
    p_email: input.email,
    p_member_role: input.memberRole,
    p_token_hash: input.tokenHash,
    p_expires_at: expiresAt.toISOString(),
    p_created_by: input.actorId,
    p_max_buffer_seats: input.maxBufferSeats,
  });

  if (error) {
    if (createdAuth && userId) await supabase.auth.admin.deleteUser(userId);
    const message = error.message ?? "";
    const seats = message.match(/seat_limit_reached:(\d+):(\d+)/);
    if (seats) return { ok: false, status: 403, body: bandBlock(Number(seats[1]), Number(seats[2])) };
    if (/email_exists/.test(message)) return { ok: false, status: 409, body: { error: "This person is already on your team.", code: "already_member" } };
    if (/max_buffer_seats:(\d+):(\d+)/.test(message)) {
      const [, used, max] = message.match(/max_buffer_seats:(\d+):(\d+)/) ?? [];
      return { ok: false, status: 403, body: { error: `Your plan has reached its buffer-agent seat limit (${used} of ${max}).`, code: "limit_reached", limitKey: "max_buffer_seats", upgrade: true } };
    }
    if (/agency_record_missing/.test(message)) return { ok: false, status: 409, body: { error: "Finish setting up your agency first: open Team › Producers and press Finish setup, then invite again.", code: "agency_record_missing" } };
    if (error.code === "PGRST202" || /could not find the function/i.test(message)) {
      return { ok: false, status: 503, body: { error: "Agency invites need a database update (20261018140000) that has not been applied yet.", code: "schema_pending" } };
    }
    console.error(`[agency invite] ${message}`);
    return { ok: false, status: 500, body: { error: "Could not invite this teammate" } };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { user_id: string; producer_id: string | null };
  return { ok: true, userId: row.user_id, producerId: row.producer_id ?? null, existing: Boolean(existing), expiresAt };
}

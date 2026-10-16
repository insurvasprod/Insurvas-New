import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { OPEN_WORK_KINDS, OPEN_WORK_LABEL, type OpenWork, type OpenWorkKind } from "./openWork";

/**
 * LA-8.6 (Notion sprint) · deactivating, reactivating and placing a member in time. The rules live in
 * the database (20261015350000) so they hold in one transaction; this maps their refusals to words.
 *
 * No permission is defined here: roles and what they may do are LA-0.2's (lib/tenantAuth/roles.ts).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

export class TeamSchemaPendingError extends Error {
  constructor() {
    super("This needs a database update (20261015350000) that has not been applied yet.");
    this.name = "TeamSchemaPendingError";
  }
}

export class MembershipRefusal extends Error {
  constructor(message: string, readonly code: string, readonly status: number, readonly openWork?: OpenWork) {
    super(message);
    this.name = "MembershipRefusal";
  }
}

const isMissing = (error: { code?: string; message?: string }) => error.code === "42883" || error.code === "PGRST202" || error.code === "42703" || /could not find the function|does not exist/i.test(error.message ?? "");

function parseOpenWork(value: unknown): OpenWork {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(OPEN_WORK_KINDS.map((kind) => [kind, Number(source[kind] ?? 0) || 0])) as OpenWork;
}

function refusal(error: { code?: string; message?: string }): Error {
  const message = error.message ?? "";
  if (isMissing(error)) return new TeamSchemaPendingError();
  const open = /open_work:(\{.*\})/.exec(message);
  if (open) {
    let work: OpenWork;
    try { work = parseOpenWork(JSON.parse(open[1])); } catch { work = parseOpenWork({}); }
    return new MembershipRefusal("This person still has open work. Choose who takes it over.", "open_work", 409, work);
  }
  if (message.includes("cannot_deactivate_self")) return new MembershipRefusal("You cannot deactivate yourself.", "self", 409);
  if (message.includes("last_owner")) return new MembershipRefusal("This is the workspace's only owner. Make someone else an owner first.", "last_owner", 409);
  if (message.includes("member_of_other_workspaces")) return new MembershipRefusal("This person also belongs to another agency's workspace, so their account cannot be switched off from here. Change their access instead, or ask Insurvas support.", "other_workspaces", 409);
  const cannot = /reassign_target_cannot_work:([a-z_,]+)/.exec(message);
  if (cannot) {
    const kinds = cannot[1].split(",").filter((k): k is OpenWorkKind => (OPEN_WORK_KINDS as readonly string[]).includes(k));
    return new MembershipRefusal(`That teammate cannot work ${kinds.map((k) => OPEN_WORK_LABEL[k][1]).join(" or ") || "some of this work"}. Choose an owner or a producer.`, "reassign_target_role", 400);
  }
  if (message.includes("reassign_target_invalid")) return new MembershipRefusal("Choose an active teammate to take the work over.", "reassign_target", 400);
  if (message.includes("not_active")) return new MembershipRefusal("This person is not active.", "not_active", 409);
  if (message.includes("not_deactivated")) return new MembershipRefusal("This person is not deactivated.", "not_deactivated", 409);
  if (message.includes("member_not_found")) return new MembershipRefusal("That person is not on this workspace.", "not_found", 404);
  if (message.includes("unknown_timezone")) return new MembershipRefusal("Choose a time zone from the list.", "timezone", 400);
  if (/seat|SEAT/.test(message)) return new MembershipRefusal("Every seat on the plan is in use. Free one, or upgrade, to make this person active again.", "seat_limit", 403);
  return new Error(message || "That did not work");
}

export async function memberOpenWork(tenantId: string, userId: string): Promise<OpenWork> {
  const { data, error } = await db().rpc("tenant_member_open_work", { p_tenant_id: tenantId, p_user_id: userId });
  if (error) throw refusal(error);
  return parseOpenWork(data);
}

export async function deactivateMember(input: { tenantId: string; userId: string; actorId: string; reassignTo: string | null }): Promise<{ open: OpenWork; moved: Partial<OpenWork>; role: string }> {
  const { data, error } = await db().rpc("tenant_deactivate_member", { p_tenant_id: input.tenantId, p_user_id: input.userId, p_actor: input.actorId, p_reassign_to: input.reassignTo });
  if (error) throw refusal(error);
  const result = (data ?? {}) as { open?: unknown; moved?: Record<string, number>; role?: string };
  return { open: parseOpenWork(result.open), moved: result.moved ?? {}, role: result.role ?? "" };
}

export async function reactivateMember(tenantId: string, userId: string): Promise<void> {
  const { error } = await db().rpc("tenant_reactivate_member", { p_tenant_id: tenantId, p_user_id: userId });
  if (error) throw refusal(error);
}

export async function setMemberTimezone(tenantId: string, userId: string, timezone: string | null): Promise<string | null> {
  const { data, error } = await db().rpc("tenant_set_member_timezone", { p_tenant_id: tenantId, p_user_id: userId, p_timezone: timezone });
  if (error) throw refusal(error);
  return (data as string | null) ?? null;
}

/** Each member's own zone; an empty map before the column exists (the screen then shows none). */
export async function memberTimezones(tenantId: string): Promise<Map<string, string>> {
  const { data, error } = await db().from("tenant_users").select("user_id, timezone").eq("tenant_id", tenantId);
  if (error) return new Map();
  return new Map(((data ?? []) as { user_id: string; timezone: string | null }[]).filter((row) => row.timezone).map((row) => [row.user_id, row.timezone as string]));
}

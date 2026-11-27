import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isPendingSchema } from "@/lib/carriers/schemaGap";
import { isExpoPushToken, type PushPlatform } from "./rules";

/**
 * The phones that get push (2026-11-24), table app_push_device (migration 20261124100000).
 * Until that migration is applied every call here is a quiet no-op: the app still works, without push.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the table is not in database.types.ts yet
const db = () => getSupabaseServiceClient() as any;

export type PushDevice = { id: string; token: string; platform: PushPlatform };

/** Register (or move) this phone's token to the person, workspace and session that asked. */
export async function registerPushDevice(input: { userId: string; tenantId: string; sessionId: string | null; token: string; platform: PushPlatform; deviceLabel: string | null }): Promise<"saved" | "pending_schema"> {
  if (!isExpoPushToken(input.token)) throw new Error("Not a push token.");
  const now = new Date().toISOString();
  // A token lives on one phone: any live row for it (another person, another workspace) is retired first.
  const retire = await db().from("app_push_device").update({ retired_at: now, retired_reason: "replaced" }).eq("token", input.token).is("retired_at", null);
  if (retire.error) {
    if (isPendingSchema(retire.error)) return "pending_schema";
    throw new Error(`Could not register the phone: ${retire.error.message}`);
  }
  const insert = await db().from("app_push_device").insert({
    user_id: input.userId, tenant_id: input.tenantId, session_id: input.sessionId, token: input.token, platform: input.platform, device_label: input.deviceLabel?.slice(0, 120) ?? null,
  });
  if (insert.error) {
    if (isPendingSchema(insert.error)) return "pending_schema";
    throw new Error(`Could not register the phone: ${insert.error.message}`);
  }
  return "saved";
}

/** Stop push to one token (the phone turned alerts off) — only the caller's own row. */
export async function retirePushToken(userId: string, token: string, reason: "turned_off" | "signed_out" = "turned_off"): Promise<void> {
  const { error } = await db().from("app_push_device").update({ retired_at: new Date().toISOString(), retired_reason: reason }).eq("user_id", userId).eq("token", token).is("retired_at", null);
  if (error && !isPendingSchema(error)) throw new Error(`Could not turn push off: ${error.message}`);
}

/** Sign out from the phone: its session's devices stop getting push. */
export async function forgetPushDevicesForSession(userId: string, sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  const { error } = await db().from("app_push_device").update({ retired_at: new Date().toISOString(), retired_reason: "signed_out" }).eq("user_id", userId).eq("session_id", sessionId).is("retired_at", null);
  if (error && !isPendingSchema(error)) throw new Error(`Could not forget the phone: ${error.message}`);
}

/**
 * The live phones of these people in this workspace. A device whose session row was ended (sign out
 * elsewhere, Signed-in devices, sign out everywhere) is left out here and retired, so ending a session
 * ends its push without a second step.
 */
export async function livePushDevices(tenantId: string, userIds: string[]): Promise<(PushDevice & { userId: string })[]> {
  if (!userIds.length) return [];
  const { data, error } = await db().from("app_push_device")
    .select("id, user_id, token, platform, session_id, tenant_user_session(revoked_at)")
    .eq("tenant_id", tenantId).in("user_id", userIds).is("retired_at", null).limit(500);
  if (error) {
    if (isPendingSchema(error)) return [];
    throw new Error(`Could not read push devices: ${error.message}`);
  }
  const rows = (data ?? []) as { id: string; user_id: string; token: string; platform: PushPlatform; session_id: string | null; tenant_user_session: { revoked_at: string | null } | null }[];
  const ended = rows.filter((r) => r.session_id && r.tenant_user_session?.revoked_at).map((r) => r.id);
  if (ended.length) {
    void db().from("app_push_device").update({ retired_at: new Date().toISOString(), retired_reason: "session_ended" }).in("id", ended).is("retired_at", null).then(() => undefined, () => undefined);
  }
  return rows.filter((r) => !ended.includes(r.id)).map((r) => ({ id: r.id, userId: r.user_id, token: r.token, platform: r.platform }));
}

/** Expo said these tokens are no longer registered (app removed, alerts revoked): never send to them again. */
export async function retireUnregisteredTokens(tokens: string[]): Promise<void> {
  if (!tokens.length) return;
  const { error } = await db().from("app_push_device").update({ retired_at: new Date().toISOString(), retired_reason: "not_registered" }).in("token", tokens).is("retired_at", null);
  if (error && !isPendingSchema(error)) console.error("[push] retire tokens", error.message);
}

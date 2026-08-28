import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getClientIp, getUserAgent } from "@/lib/request/clientInfo";
import type { LoginFailureReason } from "./constants";

export type { LoginFailureReason } from "./constants";

type RecordParams = {
  request: Request;
  email: string;
  success: boolean;
  /** Set when the attempt matched a real account; null for an unknown email. */
  userId?: string | null;
  adminId?: string | null;
  actorType: "user" | "admin";
  failureReason?: LoginFailureReason;
};

/**
 * Records one login attempt. Deliberately never throws: a logging failure must not be able to
 * block a legitimate sign-in, and on the failure path it must not change what the caller sees
 * (which would turn this into an account-enumeration oracle).
 */
export async function recordLoginEvent(params: RecordParams): Promise<void> {
  try {
    const supabase = getSupabaseServiceClient();
    await supabase.from("login_events").insert({
      actor_type: params.actorType,
      user_id: params.actorType === "user" ? (params.userId ?? null) : null,
      admin_id: params.actorType === "admin" ? (params.adminId ?? null) : null,
      email: params.email,
      ip: getClientIp(params.request),
      user_agent: getUserAgent(params.request),
      success: params.success,
      failure_reason: params.failureReason ?? null,
    });
  } catch (error) {
    console.error("[login-events] failed to record attempt", error);
  }
}

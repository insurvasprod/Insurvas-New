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
export async function recordLoginEvent(params: RecordParams): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { error } = await supabase.from("login_events").insert({
        actor_type: params.actorType,
        user_id: params.actorType === "user" ? (params.userId ?? null) : null,
        admin_id: params.actorType === "admin" ? (params.adminId ?? null) : null,
        email: params.email,
        ip: getClientIp(params.request),
        user_agent: getUserAgent(params.request),
        success: params.success,
        failure_reason: params.failureReason ?? null,
      });
      if (!error) return true;
      lastError = error;
    } catch (error) {
      lastError = error;
    }
  }
  console.error("[login-events] failed to record attempt after retry", lastError);
  return false;
}

/** Telemetry must not block authentication, but a failed last-login write is retried and visible. */
export async function recordLastLogin(actorType: "user" | "admin", id: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = actorType === "user"
        ? await supabase.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", id).select("id").maybeSingle()
        : await supabase.from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", id).select("id").maybeSingle();
      if (!result.error && result.data) return true;
      lastError = result.error;
    } catch (error) {
      lastError = error;
    }
  }
  console.error("[login-events] failed to record last login after retry", lastError);
  return false;
}

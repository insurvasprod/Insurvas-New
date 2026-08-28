import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

export type LoginEventRow = {
  id: string;
  actor_type: "user" | "admin";
  user_id: string | null;
  admin_id: string | null;
  email: string;
  ts: string;
  ip: string | null;
  user_agent: string | null;
  success: boolean;
  failure_reason: string | null;
};

export type LoginActivityStats = {
  logins_today: number;
  logins_this_week: number;
  failed_today: number;
  active_last_15_min: number;
};

/** Last N attempts for one tenant user — successes and failures both (SA-1.5). */
export async function fetchUserLoginEvents(userId: string, limit = 50): Promise<LoginEventRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("login_events")
    .select("id, actor_type, user_id, admin_id, email, ts, ip, user_agent, success, failure_reason")
    .eq("user_id", userId)
    .order("ts", { ascending: false })
    .limit(limit);

  return (data ?? []) as LoginEventRow[];
}

export async function fetchLoginActivityStats(): Promise<LoginActivityStats> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase.rpc("admin_login_activity_stats");
  const row = Array.isArray(data) ? data[0] : data;

  return (row ?? {
    logins_today: 0,
    logins_this_week: 0,
    failed_today: 0,
    active_last_15_min: 0,
  }) as LoginActivityStats;
}

export const ACTIVITY_PAGE_SIZE = 25;

/** Platform-wide feed. Always paginated — this table is the fastest-growing one in the schema. */
export async function fetchLoginActivityPage(options: {
  page: number;
  outcome?: "success" | "failure";
}): Promise<{ events: LoginEventRow[]; total: number }> {
  const supabase = getSupabaseServiceClient();

  let request = supabase
    .from("login_events")
    .select("id, actor_type, user_id, admin_id, email, ts, ip, user_agent, success, failure_reason", {
      count: "exact",
    })
    .order("ts", { ascending: false });

  if (options.outcome === "success") request = request.eq("success", true);
  if (options.outcome === "failure") request = request.eq("success", false);

  const from = (options.page - 1) * ACTIVITY_PAGE_SIZE;
  const { data, count } = await request.range(from, from + ACTIVITY_PAGE_SIZE - 1);

  return { events: (data ?? []) as LoginEventRow[], total: count ?? 0 };
}

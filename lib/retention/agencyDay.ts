import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The agency's calendar day, in its own time zone (agency_profiles.timezone, UTC when unset or not a
 * real zone). Deadlines and countdowns read it, so a US agency's evening is not already tomorrow,
 * and the board, the banner and the database's expiry all count from the same day.
 */
export async function agencyToday(tenantId: string, now: Date = new Date()): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (getSupabaseServiceClient() as any).from("agency_profiles").select("timezone").eq("tenant_id", tenantId).maybeSingle();
  return dayIn(data?.timezone ?? null, now);
}

export function dayIn(timeZone: string | null, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

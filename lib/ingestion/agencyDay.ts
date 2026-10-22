import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Loose = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = (): Loose => getSupabaseServiceClient();

/** The agency's own time zone (its profile), so "today" is the agency's day, not UTC's. */
export async function agencyTimezone(tenantId: string): Promise<string> {
  const { data } = await db().from("agency_profiles").select("timezone").eq("tenant_id", tenantId).maybeSingle();
  const zone = (data?.timezone as string | null) ?? "America/New_York";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "America/New_York";
  }
}

/** Today's date (YYYY-MM-DD) in the agency's time zone: in the evening in the US, UTC is already tomorrow. */
export async function agencyToday(tenantId: string): Promise<string> {
  return new Date().toLocaleDateString("en-CA", { timeZone: await agencyTimezone(tenantId) });
}

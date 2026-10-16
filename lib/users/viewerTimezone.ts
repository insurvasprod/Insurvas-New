import "server-only";

import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * LA-8.2 (Notion sprint) · the timezone a page shows times in for THIS person: their own display
 * timezone (My profile) when they set one, else the agency's (Business identity). It is display only —
 * the agency's day, scheduled jobs and calling windows are unchanged by it.
 *
 * Cached per person for a minute, like the workspace zone.
 */
const cache = new Map<string, { zone: string | null; at: number }>();

function knownZone(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

export async function getPersonalTimezone(userId: string): Promise<string | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.zone;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the column is newer than database.types.ts
  const { data, error } = await (getSupabaseServiceClient() as any).from("users").select("display_timezone").eq("id", userId).maybeSingle();
  const zone = error ? null : knownZone((data as { display_timezone?: string | null } | null)?.display_timezone);
  cache.set(userId, { zone, at: Date.now() });
  if (cache.size > 5000) cache.clear();
  return zone;
}

/** Forget a person's cached zone, after they change it. */
export function forgetPersonalTimezone(userId: string) {
  cache.delete(userId);
}

export async function getViewerTimezone(tenantId: string, userId: string): Promise<string | null> {
  const [mine, agency] = await Promise.all([getPersonalTimezone(userId).catch(() => null), getWorkspaceTimezone(tenantId).catch(() => null)]);
  return mine ?? agency;
}

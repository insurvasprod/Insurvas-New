import "server-only";

import { db, rows } from "@/lib/applications/db";

/**
 * Admin › Catalog › Field maps (admin round 1, catalog screen 12): the figures the staff board shows beside each
 * platform map, read across every agency because a platform map fills for all of them. Only times, counts and the
 * carrier's code are read — never a tenant, an application or a page address. Each read degrades to empty on an
 * error, so the board still draws.
 */

export const MISS_WINDOW_DAYS = 30;

/** "Last filled": the newest fill_rate event per map. */
async function lastFilled(mapIds: string[]): Promise<Record<string, string>> {
  const { data, error } = await db().from("carrier_field_map_events").select("map_id, at").eq("kind", "fill_rate").in("map_id", mapIds).order("at", { ascending: false }).limit(2000);
  if (error) return {};
  const out: Record<string, string> = {};
  for (const r of rows<{ map_id: string; at: string }>(data)) if (!out[r.map_id]) out[r.map_id] = r.at;
  return out;
}

/** "Misses · 30 days": map_miss events per map since the window opened. Null when they could not be read. */
async function missesSince(mapIds: string[], sinceIso: string): Promise<Record<string, number> | null> {
  const { data, error } = await db().from("carrier_field_map_events").select("map_id").eq("kind", "map_miss").in("map_id", mapIds).gte("at", sinceIso).limit(10000);
  if (error) return null;
  const out: Record<string, number> = {};
  for (const r of rows<{ map_id: string }>(data)) out[r.map_id] = (out[r.map_id] ?? 0) + 1;
  return out;
}

/** Each carrier's code, for `?carrier=<code>` and the link to its record (/admin/carriers/<code>). */
async function carrierCodes(carrierIds: string[]): Promise<Record<string, string>> {
  if (!carrierIds.length) return {};
  const { data, error } = await db().from("carriers").select("id, code").in("id", carrierIds);
  if (error) return {};
  return Object.fromEntries(rows<{ id: string; code: string | null }>(data).filter((r) => r.code).map((r) => [r.id, r.code as string]));
}

export type FieldMapExtras = { lastFilled: Record<string, string>; misses30: Record<string, number> | null; carrierCodes: Record<string, string> };

export async function fieldMapExtras(mapIds: string[], carrierIds: string[], now = new Date()): Promise<FieldMapExtras> {
  if (!mapIds.length) return { lastFilled: {}, misses30: {}, carrierCodes: await carrierCodes(carrierIds) };
  const since = new Date(now.getTime() - MISS_WINDOW_DAYS * 86_400_000).toISOString();
  const [filled, misses, codes] = await Promise.all([lastFilled(mapIds), missesSince(mapIds, since), carrierCodes(carrierIds)]);
  return { lastFilled: filled, misses30: misses, carrierCodes: codes };
}

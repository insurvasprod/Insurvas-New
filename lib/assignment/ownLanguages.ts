import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * A person's languages (agent_capacity.languages): what routing and Inbound read to offer callers
 * who speak them first. A manager sets them in Lead routing › Team (saveAgentCapacity); since
 * 2026-10-27 each person can set their own in Settings › My profile. Both write through
 * normalizeLanguages, so it is one value whoever saves it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent_capacity.languages is not in the generated types
const db = () => getSupabaseServiceClient() as any;

const MISSING = ["42703", "42P01", "PGRST204", "PGRST205"];

export class OwnLanguagesPendingError extends Error {
  constructor() { super("Languages need a database update that has not been applied yet."); this.name = "OwnLanguagesPendingError"; }
}

/** Lower case, trimmed, no repeats, at most 12: how every language list is stored. */
export function normalizeLanguages(languages: string[]) {
  return [...new Set(languages.map((value) => value.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

/** Your own languages; null when the column is not there yet. */
export async function readOwnLanguages(tenantId: string, userId: string): Promise<string[] | null> {
  const result = await db().from("agent_capacity").select("languages").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (result.error) {
    if (MISSING.includes(result.error.code ?? "")) return null;
    throw new Error(result.error.message);
  }
  const languages = (result.data as { languages?: unknown } | null)?.languages;
  return Array.isArray(languages) ? languages.map(String) : [];
}

/** Save your own languages. Only this person's row, in this agency; nothing else on it changes. */
export async function saveOwnLanguages(tenantId: string, userId: string, languages: string[]): Promise<string[]> {
  const result = await db().from("agent_capacity")
    .upsert({ tenant_id: tenantId, user_id: userId, languages: normalizeLanguages(languages) }, { onConflict: "tenant_id,user_id" })
    .select("languages").single();
  if (result.error || !result.data) {
    if (MISSING.includes(result.error?.code ?? "")) throw new OwnLanguagesPendingError();
    throw new Error(result.error?.message ?? "Could not save your languages");
  }
  const saved = (result.data as { languages?: unknown }).languages;
  return Array.isArray(saved) ? saved.map(String) : [];
}

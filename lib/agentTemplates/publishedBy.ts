import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Settings › Form templates, layout A (2026-10-30): who published the live version of a product's
 * form, and when. The revision row holds the time; the person comes from the revision's created_by,
 * else the publish audit row written beside it (PATCH /api/app/templates/[id]), else the person who
 * first applied the Insurvas template. `by` stays null when none of those names anyone.
 */
export type FormPublication = { at: string; by: string | null };

/** An audit row this close to the revision's time belongs to the same publish. */
const SAME_PUBLISH_MS = 2 * 60_000;

export async function livePublication(copyId: string, revision: number): Promise<FormPublication | null> {
  const supabase = getSupabaseServiceClient();
  const [rev, copy, saved] = await Promise.all([
    supabase.from("tenant_template_revisions").select("created_at, created_by").eq("tenant_template_id", copyId).eq("revision", revision).maybeSingle<{ created_at: string; created_by: string | null }>(),
    supabase.from("tenant_templates").select("applied_at, applied_by").eq("id", copyId).maybeSingle<{ applied_at: string; applied_by: string | null }>(),
    // audit_log_target_ts_idx (target_id, ts desc) answers this without a scan.
    supabase.from("audit_log").select("actor_id, ts").eq("target_id", copyId).eq("action", "tenant.form_definition_saved").order("ts", { ascending: false }).limit(1).maybeSingle<{ actor_id: string | null; ts: string }>(),
  ]);
  const at = rev.data?.created_at ?? copy.data?.applied_at ?? null;
  if (!at) return null;
  const audited = saved.data && Math.abs(Date.parse(saved.data.ts) - Date.parse(at)) <= SAME_PUBLISH_MS ? saved.data.actor_id : null;
  const personId = rev.data?.created_by ?? audited ?? (revision <= 1 ? copy.data?.applied_by ?? null : null);
  if (!personId) return { at, by: null };
  const { data: person } = await supabase.from("users").select("name").eq("id", personId).maybeSingle<{ name: string }>();
  return { at, by: person?.name?.trim() || null };
}

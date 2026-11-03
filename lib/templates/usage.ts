import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";
import type { TemplateRow } from "./constants";
import { summarizeTemplateUsage, type TemplateUsageSummary } from "./catalog";

// Untyped: templates.published_at (20260925504000) is not in database.types.ts (never edited by hand).
const db = () => getSupabaseServiceClient() as unknown as SupabaseClient;

export type TemplatePublication = {
  /** False until migration 20260925504000 adds templates.published_at. */
  draftsSupported: boolean;
  publishedAt: Record<string, string | null>;
};

/**
 * First-offered times, read separately from fetchTemplates so that shared query (and its other
 * callers) never depends on a column that may not exist yet.
 */
export async function fetchTemplatePublication(): Promise<TemplatePublication> {
  const { data, error } = await db().from("templates").select("id, published_at");
  if (error) {
    if (isSchemaGap(error)) return { draftsSupported: false, publishedAt: {} };
    throw new Error(`Could not load template publication: ${error.message}`);
  }
  return {
    draftsSupported: true,
    publishedAt: Object.fromEntries(((data ?? []) as { id: string; published_at: string | null }[]).map((row) => [row.id, row.published_at])),
  };
}

/** One template's first-offered time; `supported: false` before the migration. */
export async function fetchTemplatePublishedAt(templateId: string): Promise<{ supported: boolean; publishedAt: string | null }> {
  const { data, error } = await db().from("templates").select("published_at").eq("id", templateId).maybeSingle();
  if (error) {
    if (isSchemaGap(error)) return { supported: false, publishedAt: null };
    throw new Error(`Could not load template publication: ${error.message}`);
  }
  return { supported: true, publishedAt: (data as { published_at: string | null } | null)?.published_at ?? null };
}

/** True once templates.published_at exists. Writes that create drafts refuse until then. */
export async function templateDraftsSupported(): Promise<boolean> {
  const { error } = await db().from("templates").select("published_at").limit(1);
  if (!error) return true;
  if (isSchemaGap(error)) return false;
  throw new Error(`Could not check template drafts: ${error.message}`);
}

/**
 * How far each template reaches: agencies holding a copy (tenant_templates) and applications in
 * progress on those copies (form_drafts, each pinned to the copy revision it was started on).
 * Null when either read fails — the page shows "—" rather than a zero it cannot vouch for.
 */
export async function fetchTemplateUsage(templates: readonly Pick<TemplateRow, "id" | "version">[]): Promise<TemplateUsageSummary | null> {
  const supabase = getSupabaseServiceClient();
  const [copies, drafts] = await Promise.all([
    supabase.from("tenant_templates").select("id, template_id, template_version, definition_version"),
    supabase.from("form_drafts").select("tenant_template_id, definition_version"),
  ]);
  if (copies.error || drafts.error) return null;
  return summarizeTemplateUsage(
    templates,
    (copies.data ?? []) as { id: string; template_id: string; template_version: number; definition_version: number }[],
    (drafts.data ?? []) as { tenant_template_id: string; definition_version: number }[],
  );
}

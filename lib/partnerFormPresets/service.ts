import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { LooseDb } from "@/lib/supabase/loose";
import type { ProfileChoice } from "@/lib/agentTemplates/service";

export type PartnerFormPreset = {
  id: string;
  name: string;
  product_code: string;
  current_revision: number;
  archived_at: string | null;
  fields: ProfileChoice[];
  verification_fields: ProfileChoice[];
  source_template_revision: number;
};
type PresetRow = {
  id: string;
  name: string;
  product_code: string;
  current_revision: number;
  archived_at: string | null;
};
type PresetRevisionRow = {
  fields: unknown;
  verification_fields: unknown;
  source_template_revision: number;
};
type PresetIdentity = { id: string; current_revision: number };

const asChoices = (value: unknown): ProfileChoice[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is ProfileChoice =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as ProfileChoice).field_key === "string",
      )
    : [];

export async function listPartnerFormPresets(
  tenantId: string,
  productCode: string,
  includeArchived = false,
): Promise<PartnerFormPreset[]> {
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  let query = db
    .from<PresetRow[]>("partner_form_presets")
    .select("id, name, product_code, current_revision, archived_at")
    .eq("tenant_id", tenantId)
    .eq("product_code", productCode)
    .order("name");
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load form presets: ${error.message}`);
  return Promise.all(
    (data ?? []).map(
      async (preset: {
        id: string;
        name: string;
        product_code: string;
        current_revision: number;
        archived_at: string | null;
      }) => {
        const revision = await db
          .from<PresetRevisionRow>("partner_form_preset_revisions")
          .select("fields, verification_fields, source_template_revision")
          .eq("preset_id", preset.id)
          .eq("revision", preset.current_revision)
          .maybeSingle();
        if (revision.error || !revision.data)
          throw new Error(
            revision.error?.message ?? "Could not load preset revision",
          );
        return {
          ...preset,
          fields: asChoices(revision.data.fields),
          verification_fields: asChoices(revision.data.verification_fields),
          source_template_revision: revision.data
            .source_template_revision as number,
        };
      },
    ),
  );
}

export async function savePartnerFormPreset(
  tenantId: string,
  input: {
    id?: string;
    product_code: string;
    name: string;
    fields: ProfileChoice[];
    verification_fields: ProfileChoice[];
    source_template_revision: number;
    created_by: string;
  },
) {
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  const name = input.name.trim();
  if (!name || name.length > 120)
    throw new Error("Preset name must be between 1 and 120 characters");
  if (!input.fields.length)
    throw new Error("A preset needs at least one lead field");
  let preset: { id: string; current_revision: number } | null = null;
  if (input.id) {
    const existing = await db
      .from<PresetIdentity>("partner_form_presets")
      .select("id, current_revision")
      .eq("id", input.id)
      .eq("tenant_id", tenantId)
      .eq("product_code", input.product_code)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    preset = existing.data;
  }
  if (!preset) {
    const created = await db
      .from<PresetIdentity>("partner_form_presets")
      .insert({
        tenant_id: tenantId,
        product_code: input.product_code,
        name,
        current_revision: 1,
        created_by: input.created_by,
      })
      .select("id, current_revision")
      .single();
    if (created.error || !created.data)
      throw new Error(created.error?.message ?? "Could not create preset");
    preset = created.data;
  } else {
    const updated = await db
      .from<PresetIdentity>("partner_form_presets")
      .update({
        name,
        current_revision: preset.current_revision + 1,
        updated_at: new Date().toISOString(),
        archived_at: null,
      })
      .eq("id", preset.id)
      .eq("tenant_id", tenantId)
      .select("id, current_revision")
      .single();
    if (updated.error || !updated.data)
      throw new Error(updated.error?.message ?? "Could not revise preset");
    preset = updated.data;
  }
  if (!preset) throw new Error("Could not save preset");
  const revision = await db
    .from<unknown>("partner_form_preset_revisions")
    .insert({
      preset_id: preset.id,
      revision: preset.current_revision,
      fields: input.fields,
      verification_fields: input.verification_fields,
      source_template_revision: input.source_template_revision,
      created_by: input.created_by,
    });
  if (revision.error) throw new Error(revision.error.message);
  return { id: preset.id, revision: preset.current_revision };
}

export async function archivePartnerFormPreset(
  tenantId: string,
  presetId: string,
) {
  const db = getSupabaseServiceClient() as unknown as LooseDb;
  const { error } = await db
    .from<unknown>("partner_form_presets")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", presetId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}

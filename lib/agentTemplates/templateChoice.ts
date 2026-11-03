// Pure rules for which platform template a product hands out, and when an agent's copy is behind
// (SA-4.7 audit, 2026-10-15). No imports, so node --test loads it directly.
//
// Before: the auto-apply took the highest version number among ALL active templates of a product,
// across different template ids, and "a newer version is available" compared the agent's copy with
// that winner — so editing a second template three times made it replace the first for every new
// agent, and told agents on the first template that "v3" (of a different template) was waiting.

export type TemplateCandidate = {
  id: string;
  name: string;
  product_code: string;
  version: number;
  is_active: boolean;
  /** 20261015610000; absent before it is applied. */
  is_default?: boolean | null;
  /** When the template was first offered (20260925504000); null for a draft or before that migration. */
  published_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

const time = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

/**
 * The template a product hands out: the one the platform marked default; else the most recently
 * published (published_at, then updated_at, then created_at); ties broken by id so the answer never
 * depends on row order. Version numbers are never compared across ids — they count edits to one
 * template, not rank between templates. Inactive templates are never chosen.
 */
export function chooseProductTemplate<T extends TemplateCandidate>(candidates: readonly T[]): T | null {
  const active = candidates.filter((candidate) => candidate.is_active);
  if (active.length === 0) return null;
  const marked = active.filter((candidate) => candidate.is_default === true);
  const pool = marked.length > 0 ? marked : active;
  return [...pool].sort(
    (a, b) =>
      time(b.published_at) - time(a.published_at) ||
      time(b.updated_at) - time(a.updated_at) ||
      time(b.created_at) - time(a.created_at) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )[0];
}

/**
 * The newer version of the SAME template the agent's copy came from, or null. A different template
 * for the product — even a higher-numbered one, even the new default — is never "a newer version".
 */
export function newerVersionOfCopy<T extends TemplateCandidate>(
  copy: { template_id: string; template_version: number },
  candidates: readonly T[],
): T | null {
  const same = candidates.find((candidate) => candidate.id === copy.template_id && candidate.is_active);
  return same && same.version > copy.template_version ? same : null;
}

/**
 * Where a lead created from a product's template enters the product pipeline: the stage named like
 * the template stage it asked for (any case, active only), else the pipeline's first open stage.
 */
export function pickProductStage<S extends { id: string; name: string; position: number; stage_type: string; is_archived: boolean }>(
  stages: readonly S[],
  wantedLabel: string | null,
): S | null {
  const active = stages.filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position);
  const wanted = wantedLabel?.trim().toLowerCase();
  if (wanted) {
    const named = active.find((stage) => stage.name.trim().toLowerCase() === wanted);
    if (named) return named;
  }
  return active.find((stage) => stage.stage_type === "open") ?? null;
}

/**
 * The stages apply_template_pipeline (20261015610000) would add to a pipeline that already has
 * `existing` stage names: template order, names compared without case or surrounding spaces,
 * archived stages counting as present. Mirrors the SQL so the merge rule is pinned by a test.
 */
export function stagesToAdd<S extends { label: string; sort_order: number }>(existing: readonly string[], template: readonly S[]): S[] {
  const have = new Set(existing.map((name) => name.trim().toLowerCase()));
  const out: S[] = [];
  for (const stage of [...template].sort((a, b) => a.sort_order - b.sort_order)) {
    const key = stage.label.trim().toLowerCase();
    if (!key || have.has(key)) continue;
    have.add(key);
    out.push(stage);
  }
  return out;
}

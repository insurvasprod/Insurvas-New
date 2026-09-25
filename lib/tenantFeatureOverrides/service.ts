import "server-only";

import { OVERRIDE_DB_ERRORS, OVERRIDE_SCHEMA_PENDING_MESSAGE, type OverrideState } from "./constants";
import { isOverrideSchemaMissing, overrideRpc } from "./queries";

type StoredOverride = {
  tenant_id: string;
  feature_key: string;
  state: OverrideState;
  reason: string;
  review_on: string | null;
  set_by: string | null;
  set_at: string;
};

export type OverrideWriteResult =
  | { ok: true; before: StoredOverride | null; after: StoredOverride | null }
  | { ok: false; status: number; error: string };

function refusal(error: { code?: string; message: string }): OverrideWriteResult {
  if (isOverrideSchemaMissing(error)) return { ok: false, status: 503, error: OVERRIDE_SCHEMA_PENDING_MESSAGE };
  const key = Object.keys(OVERRIDE_DB_ERRORS).find((name) => error.message.includes(name));
  if (key) return { ok: false, status: OVERRIDE_DB_ERRORS[key].status, error: OVERRIDE_DB_ERRORS[key].message };
  // 23503: the tenant or feature vanished between the page load and the submit.
  if (error.code === "23503") return { ok: false, status: 404, error: "That tenant or feature no longer exists." };
  throw new Error(`Could not change the feature override: ${error.message}`);
}

/**
 * Sets (or replaces) one override. The database function writes the row and rebuilds the tenant's
 * entitlement in one transaction, and re-checks the role rule itself, so the tenant's next request
 * already sees the change and a wrong role cannot slip past a future caller. The caller audits.
 */
export async function setTenantFeatureOverride(input: {
  tenantId: string;
  featureKey: string;
  state: OverrideState;
  reason: string;
  reviewOn: string | null;
  adminId: string;
}): Promise<OverrideWriteResult> {
  const { data, error } = await overrideRpc()("admin_set_tenant_feature_override", {
    p_tenant_id: input.tenantId,
    p_feature_key: input.featureKey,
    p_state: input.state,
    p_reason: input.reason,
    p_review_on: input.reviewOn,
    p_admin_id: input.adminId,
  });
  if (error) return refusal(error);
  const result = data as { before: StoredOverride | null; after: StoredOverride };
  return { ok: true, before: result.before ?? null, after: result.after };
}

/** Removes one override, returning the tenant to what the plan says. Same transaction rule. */
export async function removeTenantFeatureOverride(input: {
  tenantId: string;
  featureKey: string;
  adminId: string;
}): Promise<OverrideWriteResult> {
  const { data, error } = await overrideRpc()("admin_remove_tenant_feature_override", {
    p_tenant_id: input.tenantId,
    p_feature_key: input.featureKey,
    p_admin_id: input.adminId,
  });
  if (error) return refusal(error);
  const result = data as { before: StoredOverride };
  return { ok: true, before: result.before, after: null };
}

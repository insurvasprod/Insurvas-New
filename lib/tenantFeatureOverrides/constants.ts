// Client-safe: no `server-only`, so the admin tab's client island renders from these and the rules can
// be unit-tested without a database. Reads live in ./queries, writes in ./service (both server-only).
//
// Per-tenant feature overrides — supabase/migrations/20260924344000_tenant_feature_overrides.sql.

import type { AdminRole } from "@/lib/adminAuth/roles";

export type OverrideState = "on" | "off";
export const OVERRIDE_STATES: readonly OverrideState[] = ["on", "off"] as const;

export const OVERRIDE_REASON_MIN = 5;
export const OVERRIDE_REASON_MAX = 500;

export const OVERRIDE_SCHEMA_PENDING_MESSAGE =
  "This setting needs a database update that has not been applied yet.";

/**
 * Who may change what (user decision, 2026-09-24):
 *   switch OFF, or remove an override  -> super_admin, support_agent
 *   switch ON a feature the plan lacks -> super_admin only (it hands out something nobody pays for)
 *   billing_admin                      -> read-only
 * The database re-checks the same rule in admin_set_tenant_feature_override().
 */
export const CAN_SWITCH_OFF: readonly AdminRole[] = ["super_admin", "support_agent"];
export const CAN_SWITCH_ON: readonly AdminRole[] = ["super_admin"];
export const CAN_REMOVE_OVERRIDE: readonly AdminRole[] = ["super_admin", "support_agent"];

export function canSetOverride(role: AdminRole, state: OverrideState): boolean {
  return (state === "on" ? CAN_SWITCH_ON : CAN_SWITCH_OFF).includes(role);
}

export function canRemoveOverride(role: AdminRole): boolean {
  return CAN_REMOVE_OVERRIDE.includes(role);
}

/** Any write at all — decides whether the "Add an override" form is shown. */
export function canWriteOverrides(role: AdminRole): boolean {
  return CAN_SWITCH_OFF.includes(role) || CAN_SWITCH_ON.includes(role);
}

export type OverrideRecord = {
  state: OverrideState;
  reason: string;
  review_on: string | null;
  set_at: string;
  set_by_name: string | null;
  set_by_role: string | null;
};

export type TenantFeatureRow = {
  feature_key: string;
  label: string;
  module: string;
  module_label: string;
  is_archived: boolean;
  /** Plan + attached add-ons (or the LA-0 default when there is no subscription), before overrides. */
  plan_grants: boolean;
  /** Granted by the plan itself, as opposed to only by an add-on. */
  in_plan: boolean;
  addon_names: string[];
  override: OverrideRecord | null;
};

export type TenantFeatureState = {
  /** False until the migration is applied: overrides cannot be read or written yet. */
  schemaReady: boolean;
  /** "subscription": a plan decides; "default": no subscription, the LA-0 default list decides. */
  source: "subscription" | "default";
  status: string | null;
  plan: { id: string; code: string; name: string; version: number } | null;
  tenantsOnPlan: number | null;
  features: TenantFeatureRow[];
};

/** What the tenant actually gets for one feature, before the platform kill switch. */
export function effectiveState(row: Pick<TenantFeatureRow, "plan_grants" | "override">, cancelled: boolean): OverrideState {
  if (cancelled) return "off";
  return row.override ? row.override.state : row.plan_grants ? "on" : "off";
}

/** An override that still differs from what the plan says. A plan change can make one redundant. */
export function isDeviation(row: Pick<TenantFeatureRow, "plan_grants" | "override">): boolean {
  if (!row.override) return false;
  return row.override.state === "on" ? !row.plan_grants : row.plan_grants;
}

/** "Growth v4", or the words for a tenant with no subscription. */
export function planLabel(state: Pick<TenantFeatureState, "plan" | "source">): string {
  if (state.plan) return `${state.plan.name} v${state.plan.version}`;
  return state.source === "default" ? "the default access" : "the plan";
}

/** Why a submitted override would be refused, in words an admin can act on — null when it is fine. */
export function overrideRefusal(input: {
  role: AdminRole;
  state: OverrideState;
  reason: string;
  planGrants: boolean | null;
}): string | null {
  if (!canSetOverride(input.role, input.state)) {
    return input.state === "on"
      ? "Only a super admin can switch on a feature the plan does not include."
      : "Your role cannot change feature overrides.";
  }
  const reason = input.reason.trim();
  if (reason.length < OVERRIDE_REASON_MIN) return `Give a reason of at least ${OVERRIDE_REASON_MIN} characters.`;
  if (reason.length > OVERRIDE_REASON_MAX) return `Keep the reason under ${OVERRIDE_REASON_MAX} characters.`;
  if (input.planGrants !== null && (input.state === "on") === input.planGrants) {
    return input.state === "on"
      ? "The plan already includes this feature. An override has to differ from the plan."
      : "The plan does not include this feature, so there is nothing to switch off.";
  }
  return null;
}

/** Database refusals (raised by the 20260924344000 functions) as sentences. */
export const OVERRIDE_DB_ERRORS: Record<string, { status: number; message: string }> = {
  override_state_invalid: { status: 400, message: "Choose On or Off." },
  override_reason_required: { status: 400, message: `Give a reason of ${OVERRIDE_REASON_MIN}–${OVERRIDE_REASON_MAX} characters.` },
  override_admin_not_allowed: { status: 403, message: "Your role cannot change feature overrides." },
  override_on_super_admin_only: { status: 403, message: "Only a super admin can switch on a feature the plan does not include." },
  override_feature_unknown: { status: 400, message: "That feature is not in the catalog." },
  override_feature_archived: { status: 400, message: "That feature is archived. Archived features cannot be given new overrides." },
  override_tenant_not_found: { status: 404, message: "This tenant does not exist." },
  override_tenant_cancelled: { status: 409, message: "This tenant's subscription is cancelled, so nothing is granted and an override would change nothing." },
  override_matches_plan: { status: 409, message: "The plan already says that. An override has to differ from the plan." },
  override_not_found: { status: 404, message: "There is no override on that feature any more. Reload to see the current state." },
};

/** "R. Gllareva" — the board's short form of an admin's name. */
export function shortName(name: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? null;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

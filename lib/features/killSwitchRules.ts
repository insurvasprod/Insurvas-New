// Client-safe: no `server-only` import, so the admin toggle UI renders from these and they can be
// unit-tested without a database. The read and the cache live in ./killSwitch, which is server-only.

export const SWITCH_STATES = ["on", "off", "beta"] as const;
export type SwitchState = (typeof SWITCH_STATES)[number];

export type FeatureSwitch = {
  feature_key: string;
  state: SwitchState;
  beta_tenant_ids: string[];
  off_message: string | null;
  updated_at: string | null;
};

export const SWITCH_STATE_LABELS: Record<SwitchState, string> = {
  on: "On",
  off: "Off for everyone",
  beta: "Named tenants only",
};

export const SWITCH_STATE_HELP: Record<SwitchState, string> = {
  on: "Normal. Whoever's plan includes it, gets it.",
  off: "Nobody can reach it, including tenants whose plan includes it and is paid for.",
  beta: "On for the tenants listed below and off for everyone else.",
};

/**
 * THE rule, in one place.
 *
 * Every enforcement point — the menu, the route guard and the API — resolves through this, so
 * they cannot drift apart. That drift is exactly what the ticket's "confusing the two produces a
 * mess" warning is about, and it is the reason this is a pure function rather than three `if`s in
 * three files.
 *
 * A feature with no switch row is available. The table holds exceptions only.
 */
export function isFeatureAvailable(
  featureSwitch: FeatureSwitch | undefined,
  tenantId: string,
): boolean {
  if (!featureSwitch) return true;

  switch (featureSwitch.state) {
    case "on":
      return true;
    case "off":
      return false;
    case "beta":
      return featureSwitch.beta_tenant_ids.includes(tenantId);
  }
}

/**
 * Filters an entitlement's feature list down to what is actually reachable right now.
 *
 * Kill switch first, then entitlement: this runs over features the tenant has already been granted,
 * and can only ever remove. A switch cannot hand someone a feature they did not pay for.
 */
export function applyKillSwitches(
  grantedFeatureKeys: readonly string[],
  switches: ReadonlyMap<string, FeatureSwitch>,
  tenantId: string,
): string[] {
  return grantedFeatureKeys.filter((key) => isFeatureAvailable(switches.get(key), tenantId));
}

/**
 * What to tell an agent who reached a killed feature directly.
 *
 * Null means say nothing beyond "not available" — the ticket allows a switch with no message, and
 * inventing one would be worse than silence. Never leaks the beta tenant list.
 */
export function killSwitchNotice(featureSwitch: FeatureSwitch | undefined): string | null {
  if (!featureSwitch || featureSwitch.state === "on") return null;
  return featureSwitch.off_message?.trim() || null;
}

export const OFF_MESSAGE_MAX = 300;

/** Why a submitted switch was refused, in words an admin can act on. */
export function switchRefusalReason(input: {
  state: string;
  betaTenantIds: string[];
  offMessage: string | null;
}): string | null {
  if (!(SWITCH_STATES as readonly string[]).includes(input.state)) {
    return `State must be one of: ${SWITCH_STATES.join(", ")}.`;
  }
  if (input.state === "beta" && input.betaTenantIds.length === 0) {
    // Silently equivalent to "off", which is a confusing thing to leave an admin looking at.
    return "Named-tenants mode needs at least one tenant, otherwise it is the same as Off.";
  }
  if (input.offMessage && input.offMessage.length > OFF_MESSAGE_MAX) {
    return `The message must be ${OFF_MESSAGE_MAX} characters or fewer.`;
  }
  return null;
}

// Suspending an agency: the rules, with no I/O, so every plane and the tests read the same ones.
//
// Plain module on purpose. The admin dialog (a client component), the admin route, the agent and
// partner session guards and the login routes all import from here, and the tests run it under
// `node --experimental-strip-types` — so no `server-only`, no `@/` imports.
//
// What a suspension is (decision 4): nobody in the agency can sign in or keep using a session.
// Billing and data are untouched — the subscription, its invoices and the billing crons carry on,
// and nothing is deleted. It is reversible: unsuspending puts the tenant back where it was.

/** What anyone in a suspended agency is told, at sign-in and on any request with an old session. */
export const TENANT_SUSPENDED_MESSAGE = "This agency's account is suspended. Contact support.";

/** Machine-readable twin of the message, for API callers that branch on it. */
export const TENANT_SUSPENDED_CODE = "tenant_suspended";

/** The tenant states a suspension can start from. `cancelled` is over already; suspending it means nothing. */
export const SUSPENDABLE_TENANT_STATUSES = ["active", "provisioning"] as const;
export type SuspendableTenantStatus = (typeof SUSPENDABLE_TENANT_STATUSES)[number];

export const SUSPENSION_REASON_MIN = 5;
export const SUSPENSION_REASON_MAX = 500;

export function isTenantSuspended(status: string | null | undefined): boolean {
  return status === "suspended";
}

export type SuspensionAction = "suspend" | "unsuspend";

/**
 * Why this transition cannot happen from `status`, or null when it can. Named states rather than
 * "not allowed", so the admin learns where the tenant is and what would work.
 */
export function suspensionRefusal(status: string, action: SuspensionAction): string | null {
  if (action === "suspend") {
    if (status === "suspended") return "This agency is already suspended.";
    if (!(SUSPENDABLE_TENANT_STATUSES as readonly string[]).includes(status)) {
      return `Only an active or provisioning agency can be suspended. This one is ${status}.`;
    }
    return null;
  }
  return status === "suspended" ? null : `Only a suspended agency can be unsuspended. This one is ${status}.`;
}

/** Typed confirmation: the tenant's name, ignoring surrounding spaces and runs of whitespace. */
export function confirmsTenantName(typed: string | null | undefined, tenantName: string): boolean {
  const norm = (value: string) => value.trim().replace(/\s+/g, " ");
  return typeof typed === "string" && norm(typed) !== "" && norm(typed) === norm(tenantName);
}

export type SuspensionInput = { action: SuspensionAction; reason: string; confirmName?: string };

/**
 * Validates what the admin sent. Returns the cleaned reason, or the message to show. The typed
 * name is required for suspend only — unsuspending gives access back and needs no second key.
 */
export function validateSuspensionInput(
  input: SuspensionInput,
  tenantName: string,
): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = input.reason.trim();
  if (reason.length < SUSPENSION_REASON_MIN) {
    return { ok: false, error: `Give a reason of at least ${SUSPENSION_REASON_MIN} characters.` };
  }
  if (reason.length > SUSPENSION_REASON_MAX) {
    return { ok: false, error: `Keep the reason under ${SUSPENSION_REASON_MAX} characters.` };
  }
  if (input.action === "suspend" && !confirmsTenantName(input.confirmName, tenantName)) {
    return { ok: false, error: "Type the agency's name exactly to confirm." };
  }
  return { ok: true, reason };
}

/**
 * Where unsuspending returns the tenant: the state it was suspended from, as the suspend audit row
 * recorded it. Anything unrecognised — an old row, a suspension made outside this screen — goes
 * back to `active`, which is what "reversible" means for every agency that was working.
 */
export function statusAfterUnsuspend(recordedFrom: unknown): SuspendableTenantStatus {
  return recordedFrom === "provisioning" ? "provisioning" : "active";
}

/**
 * Memberships a person may still sign in to: those whose agency is not suspended. A person in two
 * agencies, one suspended, still reaches the other — the suspension is the agency's, not theirs.
 * A membership whose tenant row is missing is kept, so the existing "no such tenant" path decides.
 */
export function membershipsOutsideSuspendedTenants<T extends { tenant_id: string }>(
  memberships: T[],
  tenantStatusById: ReadonlyMap<string, string>,
): T[] {
  return memberships.filter((row) => !isTenantSuspended(tenantStatusById.get(row.tenant_id)));
}

import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { actAs, contextRoles, getTenantSession, resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "./get";
import { hasFeature, isDisabledForTenant, type Entitlement } from "./types";
import { featureKillState } from "@/lib/features/killSwitch";
import { allMenuItems } from "@/lib/menu/definition";
import { APP_PATH_HEADER, isHiddenPath } from "@/lib/tenantAuth/teamAccess";
import type { TenantRole } from "@/lib/tenantAuth/roles";
import { rolesWithPermission, type TenantPermission } from "@/lib/tenantAuth/permissions";
import type { TenantContext } from "@/lib/tenantAuth/requireTenant";

/**
 * Enforcement point 2 of 3: the ROUTE GUARD.
 *
 * Catches someone pasting a URL for a page their plan doesn't include. Without it they'd reach a
 * page that renders half-broken; with it they get an upgrade prompt instead of a dead end.
 *
 * Still not security — the page's data comes from APIs, and those are guarded separately by
 * requireFeature(). This is about not showing someone a broken screen.
 */
type GuardCommon = { entitlement: Entitlement; role: TenantRole; roles: TenantRole[]; context: TenantContext; feature: string };
export type PageGuardResult =
  | ({ entitled: true; killed: false; disabled: false; hidden: false; notice: null } & GuardCommon)
  // Killed and unentitled are kept apart so the page can show a maintenance notice rather than an
  // upgrade prompt. Selling someone an upgrade for something that is switched off platform-wide
  // is the specific mistake SA-4.10 exists to prevent. `disabled` is the same mistake one tenant
  // wide: staff switched a feature their plan includes off for them alone, so the page says "not
  // available on your account" instead of offering an upgrade. `hidden`: the agency hid this page
  // for this member (custom team access) — neither an upgrade nor an outage.
  | ({ entitled: false; killed: boolean; disabled: boolean; hidden: boolean; notice: string | null } & GuardCommon);

export async function guardPage(featureKey: string): Promise<PageGuardResult> {
  // Fetched together, decided in order — the same shape as requireFeature. The entitlement and
  // kill-switch reads are keyed by the tenant id in the verified session JWT, so they never needed
  // to wait for the membership lookup. All three are memoised for the request, so when the shell
  // layout has already asked (a full page load) this costs nothing at all.
  const session = await getTenantSession();
  if (!session) redirect("/app/login");

  const settle = <T,>(promise: Promise<T>) =>
    promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  const [resolved, entitlementSettled, killSettled] = await Promise.all([
    resolveTenantContext(),
    settle(getEntitlement(session.tenantId)),
    settle(featureKillState(featureKey, session.tenantId)),
  ]);
  if (!resolved) redirect("/app/login");
  if (!entitlementSettled.ok) throw entitlementSettled.error;
  if (!killSettled.ok) throw killSettled.error;
  const entitlement = entitlementSettled.value;
  // This page's own copy: actAsPage may change its role without touching the request-wide context.
  const context: TenantContext = { ...resolved };
  const common: GuardCommon = { entitlement, role: context.role, roles: contextRoles(context), context, feature: featureKey };

  // Kill switch first, then entitlement — the same order as requireFeature (SA-4.10).
  const kill = killSettled.value;
  if (kill.killed) {
    return { entitled: false, killed: true, disabled: false, hidden: false, notice: kill.notice, ...common };
  }

  if (await pageHiddenFor(context)) {
    return { entitled: false, killed: false, disabled: false, hidden: true, notice: null, ...common };
  }

  return hasFeature(entitlement, featureKey)
    ? { entitled: true, killed: false, disabled: false, hidden: false, notice: null, ...common }
    : { entitled: false, killed: false, disabled: isDisabledForTenant(entitlement, featureKey), hidden: false, notice: null, ...common };
}

async function pageHiddenFor(context: TenantContext): Promise<boolean> {
  if (!context.hiddenPages?.length) return false;
  const hidden = new Set(context.hiddenPages);
  const paths = allMenuItems().filter((entry) => hidden.has(entry.key)).map((entry) => entry.path);
  return isHiddenPath((await headers()).get(APP_PATH_HEADER), paths);
}

/**
 * The page's role gate. True when any role the member holds is allowed; the guard then acts as that role (the main
 * role when it is allowed), so everything the page decides from guard.role afterwards is decided for a role the
 * page admits. Replaces `allowed.includes(guard.role)`.
 */
export function actAsPage(guard: PageGuardResult, allowed: readonly TenantRole[]): boolean {
  const acting = actAs(guard.context, allowed);
  if (!acting) return false;
  if (acting !== guard.context) {
    Object.assign(guard.context, acting);
    guard.role = acting.role;
  }
  return true;
}

/**
 * The same gate for a page that admits a PERMISSION rather than a list of roles: true when any role the member
 * holds carries it (the dialer for an assistant who is also a setter). Replaces `hasTenantPermission(guard.role, …)`
 * as a gate, which read the main role only.
 */
export function actAsPagePermission(guard: PageGuardResult, permission: TenantPermission): boolean {
  return actAsPage(guard, rolesWithPermission(permission));
}

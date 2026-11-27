import { NextResponse } from "next/server";

import { scopeFor } from "@/lib/agency/visibility";
import { getEntitlement } from "@/lib/entitlements/get";
import { applyRetentionWindow } from "@/lib/entitlements/types";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { buildAgentMenu } from "@/lib/menu/definition";
import { requireTenant } from "@/lib/tenantAuth/requireTenant";
import { readTenantScoped } from "@/lib/tenantDb/withTenantScope";
import { isSoloWorkspace } from "@/lib/tenantTeam/solo";

export async function GET() {
  const auth = await requireTenant();
  if (auth instanceof NextResponse) return auth;
  const { context } = auth;

  // Runs through the tenant_app Postgres role (RLS enforced), not the service-role client —
  // this is the read that actually proves tenant isolation, not just an application-layer filter.
  // One round trip to the pooler (readTenantScoped), not five in a row.
  const [[users, tenants], entitlement, switches, scope, solo] = await Promise.all([
    readTenantScoped(context.tenantId, context.userId, [
      "select id, email, name, status, last_login_at from users where id = $user",
      "select id, name, status, plan_code from tenants where id = $tenant",
    ]),
    // The plan's feature keys (2026-11-26): the phone hides what the plan does not include, as the web
    // menu does. A failed read hides nothing; every route still checks the feature itself.
    getEntitlement(context.tenantId).then(applyRetentionWindow).catch(() => null),
    loadFeatureSwitches().catch(() => null),
    scopeFor(context).catch(() => null),
    isSoloWorkspace(context.tenantId),
  ]);
  const user = users[0] ?? null;
  const tenant = tenants[0] ?? null;

  if (!user || !tenant) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // menuKeys (2026-11-26 role walk): the keys of the web sidebar this person sees, built exactly as the web
  // shell builds it (app/app/(shell)/layout.tsx): effective features, the member role and extra roles, the
  // agency scope (AG-0.5: a producer, manager, assistant or setter inside an agency is not offered the
  // agency's own screens, whose APIs refuse them), the pages the owner hid, and solo mode. The phone shows a
  // Menu row only when its key is here, so it never offers a page that answers "handled by the owner".
  const menuKeys = entitlement
    ? buildAgentMenu(switches ? applyKillSwitches(entitlement.features, switches, context.tenantId) : entitlement.features, context.memberRole ?? context.role, {
        agencyNarrow: scope !== null,
        extraRoles: (context.roles ?? []).slice(1),
        hiddenPages: context.hiddenPages,
        solo,
      }).flatMap((section) => section.items.map((item) => item.key))
    : null;

  // memberRole / agencyTitle / roles (2026-11-24): the phone app picks its five tabs from them; the
  // server still gates every route by the base role, so these only shape what the app shows.
  return NextResponse.json({
    user,
    tenant,
    role: context.role,
    memberRole: context.memberRole ?? context.role,
    agencyTitle: context.agencyTitle ?? null,
    roles: context.roles ?? [context.role],
    plan: entitlement
      ? { code: entitlement.plan_code, name: entitlement.plan_name ?? null, access: entitlement.access, features: entitlement.features, disabled: entitlement.disabled_features ?? [] }
      : null,
    menuKeys,
    // Solo mode (lib/tenantTeam/solo.ts): an individual plan with no other caller. The phone gives such an owner
    // the tabs of the work they do themselves (owner 2026-11-26), not the agency's Team · Money.
    solo,
  });
}

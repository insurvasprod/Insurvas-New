import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { buildAgentMenu } from "@/lib/menu/definition";
import { AgentSidebar } from "@/components/app/agent-sidebar";
import { LogoutButton } from "@/components/app/logout-button";

/**
 * Enforcement point 1 of 3: the MENU.
 *
 * Cosmetic on its own — a determined user can still paste a URL or hand-craft a request, which
 * is what the route guard and requireFeature() are for. But it's what makes the product feel
 * like it was built for the plan they bought.
 */
export default async function AgentShellLayout({ children }: { children: React.ReactNode }) {
  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  const entitlement = await getEntitlement(context.tenantId);
  const menu = buildAgentMenu(entitlement.features);

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col justify-between bg-[var(--brand-700)] p-4 text-white">
        <div>
          <div className="mb-6 flex items-center gap-2 px-2">
            <Building2 className="size-5" />
            <span className="font-semibold tracking-tight">Insurvas</span>
          </div>
          <AgentSidebar menu={menu} />
        </div>

        <div className="space-y-3 border-t border-white/10 pt-4">
          {entitlement.plan_code && (
            <p className="px-2 text-xs text-white/70">
              {entitlement.plan_code} · {entitlement.features.length} features
            </p>
          )}
          <div className="px-2">
            <LogoutButton />
          </div>
        </div>
      </aside>

      <main className="flex-1 bg-[var(--color-page-bg)] p-8">
        {entitlement.access === "read_only" && (
          <div className="mb-6 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-4 text-sm">
            <span className="font-medium">
              Your account is {entitlement.status === "paused" ? "paused" : "suspended"}.
            </span>{" "}
            You can still view your book of business — anything that creates or sends is disabled.
            Contact your administrator.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

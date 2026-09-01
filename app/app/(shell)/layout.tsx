import { redirect } from "next/navigation";

import { resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { getEntitlement } from "@/lib/entitlements/get";
import { buildAgentMenu } from "@/lib/menu/definition";
import { effectiveFeatures } from "@/lib/features/killSwitch";
import { AgentSidebar } from "@/components/app/agent-sidebar";
import { LogoutButton } from "@/components/app/logout-button";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { trialBanner } from "@/lib/trials/banner";
import { outstandingDocuments } from "@/lib/legal/acceptance";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { MaintenanceMessage } from "@/components/app/maintenance-message";
import { AnnouncementStrip } from "@/components/app/announcement-strip";
import { getMaintenanceStatus, getActiveAnnouncements } from "@/lib/system/service";
import { planDisplayName } from "@/lib/plans/display";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Enforcement point 1 of 3: the MENU.
 *
 * Cosmetic on its own — a determined user can still paste a URL or hand-craft a request, which
 * is what the route guard and requireFeature() are for. But it's what makes the product feel
 * like it was built for the plan they bought.
 */
export default async function AgentShellLayout({ children }: { children: React.ReactNode }) {
  // Self-serve users must finish the gated signup states before the normal entitlement shell.
  // Existing admin-created tenants use `not_started`, so they continue unchanged.
  const signupContext = await resolveSignupContext();
  if (signupContext) {
    const destination = signupDestination(signupContext);
    if (destination) redirect(destination);
  }

  const context = await resolveTenantContext();
  if (!context) redirect("/app/login");

  // SA-5.4: a material new version blocks the product until it is accepted. Placed after the
  // session resolves and before the entitlement is read, so it cannot be skipped by deep-linking
  // to any page inside the shell — every one of them renders through here.
  const outstanding = await outstandingDocuments(context.userId);
  if (outstanding.length > 0) redirect("/app/accept-terms");

  const entitlement = await getEntitlement(context.tenantId);
  const maintenance = await getMaintenanceStatus();
  if (maintenance.level === "locked") redirect("/maintenance");
  const announcements = await getActiveAnnouncements(context.userId, context.tenantId);

  // The menu is built from EFFECTIVE features — what the plan grants, minus anything switched off
  // platform-wide right now (SA-4.10). Filtering here rather than inside buildAgentMenu keeps that
  // function pure and shared with the admin plan preview, which deliberately shows plan grants
  // rather than the current outage state.
  const available = await effectiveFeatures(entitlement.features, context.tenantId);
  const menu = buildAgentMenu(available);

  const footer = (
    <div className="space-y-3">
      {entitlement.plan_code && (
        <p className="px-3 text-xs text-white/60">
          {/* Was `plan_c · 14 features`. A plan code is a database key, and a feature count is a
              number nobody asked for; the name they were sold is the thing they recognise. */}
          {planDisplayName(entitlement.plan_code)} plan
        </p>
      )}
      <div className="space-y-2 px-3">
        <ThemeToggle tone="onBrand" />
        <LogoutButton />
      </div>
    </div>
  );

  // SA-5.3: the in-app half of the day-13 reminder. Only queried for a tenant actually on trial,
  // and trial_ends_at is deliberately not added to the entitlement contract — that object is the
  // versioned agreement between the two planes, not a place for screen-level trivia.
  let banner = null;
  if (entitlement.status === "trialing") {
    const { data: sub } = await getSupabaseServiceClient()
      .from("subscriptions")
      .select("trial_ends_at")
      .eq("tenant_id", context.tenantId)
      .eq("status", "trialing")
      .maybeSingle();
    banner = trialBanner(sub?.trial_ends_at ? new Date(sub.trial_ends_at) : null);
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <AgentSidebar menu={menu} footer={footer} />

      {/* min-w-0 is load-bearing, for the same reason it is on the admin shell: a flex item
          defaults to min-width:auto, so <main> refuses to shrink below its widest child and one
          wide table drags the whole page sideways. */}
      <main className="min-w-0 flex-1 bg-[var(--color-page-bg)] p-4 sm:p-6 lg:p-8">
        {/* Ordered by urgency: a platform-wide outage outranks a campaign announcement, which
            outranks a trial ending, which outranks an account already known to be read-only. */}
        <MaintenanceMessage status={maintenance} />
        <AnnouncementStrip initialAnnouncements={announcements} />
        {banner && (
          <div
            className={`mb-6 rounded-lg border p-4 text-sm ${
              banner.tone === "urgent"
                ? "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10"
                : "border-border bg-muted/40"
            }`}
          >
            {banner.message}
          </div>
        )}
        {entitlement.access === "read_only" && (
          <div
            role="status"
            className="mb-6 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 p-4 text-sm"
          >
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

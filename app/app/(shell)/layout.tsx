import { redirect } from "next/navigation";

import { getTenantSession, resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { prefetchTopBarIdentity, readTopBarIdentity } from "@/lib/tenantAuth/topBarIdentity";
import { getEntitlement } from "@/lib/entitlements/get";
import { buildAgentMenu } from "@/lib/menu/definition";
import { loadFeatureSwitches } from "@/lib/features/killSwitch";
import { applyKillSwitches } from "@/lib/features/killSwitchRules";
import { AgentSidebar } from "@/components/app/agent-sidebar";
import { resolveSignupContext, signupDestination } from "@/lib/signup/context";
import { outstandingDocuments } from "@/lib/legal/acceptance";
import { MaintenanceMessage } from "@/components/app/maintenance-message";
import { AnnouncementStrip } from "@/components/app/announcement-strip";
import { SubscriptionStateBanner } from "@/components/app/subscription-state-banner";
import { getMaintenanceStatus, getActiveAnnouncements } from "@/lib/system/service";
import { planDisplayName } from "@/lib/plans/display";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppTopBar } from "@/components/app/app-top-bar";
import { AgentWorkspaceBar } from "@/components/app/agent-workspace-bar";
import { NotifySoundPrimer } from "@/components/app/notify-sound-primer";
import { PortalPageTransition } from "@/components/portal/portal-page-transition";

/**
 * Enforcement point 1 of 3: the MENU.
 *
 * Cosmetic on its own — a determined user can still paste a URL or hand-craft a request, which
 * is what the route guard and requireFeature() are for. But it's what makes the product feel
 * like it was built for the plan they bought.
 */
export default async function AgentShellLayout({ children }: { children: React.ReactNode }) {
  // Every read below is keyed by the verified session JWT alone (user id and tenant id are signed by
  // us), so none waits on another. They used to run one after another — seven trips to a remote
  // database, ~170–220ms each, before a single page could start. Now they are one round trip.
  //
  // THE DECISION ORDER IS UNCHANGED: signup gate, then session, then legal re-acceptance, then
  // maintenance. Only fetching is concurrent. Speculative reads are settled rather than awaited, so
  // a failure in one cannot surface ahead of a redirect the user should have received first.
  const session = await getTenantSession();
  if (!session) redirect("/app/login");

  const settle = <T,>(promise: Promise<T>) =>
    promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  const unwrap = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
    if (!result.ok) throw result.error;
    return result.value;
  };

  const [signupContext, context, outstandingSettled, entitlementSettled, maintenance, announcementsSettled, switchesSettled] =
    await Promise.all([
      resolveSignupContext(),
      resolveTenantContext(),
      settle(outstandingDocuments(session.sub)),
      settle(getEntitlement(session.tenantId)),
      getMaintenanceStatus(),
      settle(getActiveAnnouncements(session.sub, session.tenantId)),
      settle(loadFeatureSwitches()),
      // Display-only; started here so `readTopBarIdentity` below finds it already fetched.
      settle(prefetchTopBarIdentity(session.sub, session.tenantId)),
    ]);

  // Self-serve users must finish the gated signup states before the normal entitlement shell.
  // Existing admin-created tenants use `not_started`, so they continue unchanged.
  if (signupContext) {
    const destination = signupDestination(signupContext);
    if (destination) redirect(destination);
  }

  if (!context) redirect("/app/login");

  // SA-5.4: a material new version blocks the product until it is accepted. Decided after the
  // session resolves and before the entitlement is used, so it cannot be skipped by deep-linking
  // to any page inside the shell — every one of them renders through here.
  const outstanding = unwrap(outstandingSettled);
  if (outstanding.length > 0) redirect("/app/accept-terms");

  const entitlement = unwrap(entitlementSettled);
  if (maintenance.level === "locked") redirect("/maintenance");
  const announcements = unwrap(announcementsSettled);

  // The menu is built from EFFECTIVE features — what the plan grants, minus anything switched off
  // platform-wide right now (SA-4.10). Filtering here rather than inside buildAgentMenu keeps that
  // function pure and shared with the admin plan preview, which deliberately shows plan grants
  // rather than the current outage state.
  const available = applyKillSwitches(entitlement.features, unwrap(switchesSettled), context.tenantId);
  const menu = buildAgentMenu(available, context.role);
  const planName = entitlement.plan_code ? planDisplayName(entitlement.plan_code) : null;
  const identity = await readTopBarIdentity(context);
  const moduleAccess = {
    inbound: available.includes("inbound_transfers"),
    outbound:
      available.includes("outbound_dialing") ||
      available.includes("lead_import") ||
      available.includes("true_cpa"),
  };

  // No sign-out here: it is the labelled last row of the top bar's account menu, and a second copy
  // at the foot of the rail was the "lone way out" the top-bar board rules against. The theme
  // toggle stays until it has a home of its own.
  const footer = <ThemeToggle tone="onBrand" />;
  const plan = {
    name: planName,
    seats: entitlement.limits.max_seats,
    roleLabel: identity.roleLabel,
    isOwner: context.role === "owner",
  };

  return (
    <div className="portal-agent flex min-h-screen flex-col md:flex-row">
      <AgentSidebar
        menu={menu}
        footer={footer}
        moduleAccess={moduleAccess}
        plan={plan}
      />
      {/* Opens the audio context on the first gesture. Mounted beside the bridge because the
          two together are the whole sound story on this plane: the bridge covers call sites
          not yet migrated, this primes the layer that governs the ones that are. */}
      <NotifySoundPrimer />

      {/* min-w-0 is load-bearing, for the same reason it is on the admin shell: a flex item
          defaults to min-width:auto, so <main> refuses to shrink below its widest child and one
          wide table drags the whole page sideways.
          overflow-x-CLIP, not hidden: `hidden` makes <main> a scroll container, and the sticky top
          bar then sticks to a box that never scrolls — so it scrolled off with the page. */}
      <main className="min-w-0 flex-1 overflow-x-clip bg-[var(--color-page-bg)] flex flex-col">
        {/* The bar is chrome and always present. Below it, ordered by urgency: a platform-wide
            outage outranks a campaign announcement, which outranks a trial ending, which
            outranks an account already known to be read-only. */}
        <AppTopBar user={identity} />
        <AgentWorkspaceBar
          workspaceName={identity.workspaceName}
          planName={planName}
          roleLabel={identity.roleLabel}
          readOnly={entitlement.access === "read_only" || maintenance.level === "read_only"}
          maintenance={maintenance.level}
        />
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
        <MaintenanceMessage status={maintenance} />
        <AnnouncementStrip initialAnnouncements={announcements} />
        <SubscriptionStateBanner status={entitlement.status} />
        <PortalPageTransition>{children}</PortalPageTransition>
      </div>
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";

import { getTenantSession, resolveTenantContext } from "@/lib/tenantAuth/requireTenant";
import { prefetchTopBarIdentity, readTopBarIdentity } from "@/lib/tenantAuth/topBarIdentity";
import { getEntitlement } from "@/lib/entitlements/get";
import { buildAgentMenu } from "@/lib/menu/definition";
import { scopeFor, visibleProducerUserIds } from "@/lib/agency/visibility";
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
import { AppTopBar } from "@/components/app/app-top-bar";
import { NotifySoundPrimer } from "@/components/app/notify-sound-primer";
import { PortalPageTransition } from "@/components/portal/portal-page-transition";
import { OverdueComplaintBanner } from "@/components/app/overdue-complaint-banner";
import { overdueRegulatorComplaintCount } from "@/lib/compliance/complaintBanner";
import { readSetupStamps, SETUP_MENU_ITEM, setupStillOpen } from "@/lib/dashboard/setupViewer";
import { SetupGuideBar } from "@/components/app/setup/setup-guide-bar";
import { LiveTransferCard } from "@/components/app/inbound/live-transfer-card";
import { Suspense } from "react";

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

  const [signupContext, context, outstandingSettled, entitlementSettled, maintenance, announcementsSettled, switchesSettled, , , overdueComplaints, setupStamps] =
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
      // The producer scope for the menu, started with the rest (it is a per-request cache keyed by these
      // same two ids, so `scopeFor(context)` below picks it up instead of making its own trip).
      settle(visibleProducerUserIds(session.tenantId, session.sub)),
      // LA-6.4: a regulator complaint past its deadline (one counted read; 0 on any failure).
      overdueRegulatorComplaintCount(session.tenantId),
      // The walkthrough's two finished stamps, for the "Get set up" item (never throws; a failure reads as finished).
      readSetupStamps(session.tenantId, session.sub),
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
  // AG-0.2: the member role, so an agency title sees its own items (an admin's and a manager's menus).
  // AG-0.5: a narrowed session inside an agency is not offered the agency's own screens (their APIs refuse it).
  const agencyNarrow = (await scopeFor(context)) !== null;
  // Custom team access: every role the member holds opens its items, minus the pages the owner hid for them.
  const menu = buildAgentMenu(available, context.memberRole ?? context.role, {
    agencyNarrow,
    extraRoles: (context.roles ?? []).slice(1),
    hiddenPages: context.hiddenPages,
  });
  // 2026-10-21 walkthrough: "Get set up" sits under Home until this person's setup is finished.
  if (setupStillOpen(setupStamps, context, available)) {
    const home = menu.find((section) => section.id === "home");
    if (home) home.items = [...home.items, SETUP_MENU_ITEM];
  }
  const planName = entitlement.plan_code ? planDisplayName(entitlement.plan_code, entitlement.plan_name) : null;
  const identity = await readTopBarIdentity(context);
  const moduleAccess = {
    inbound: available.includes("inbound_transfers"),
    outbound:
      available.includes("outbound_dialing") ||
      available.includes("lead_import") ||
      available.includes("true_cpa"),
  };

  // Inbound A (2026-10-25): the live-transfer card on every page, for the roles that take transfers
  // (the inbox's own gate: owner, producer, assistant) on a plan that has them.
  const takesTransfers = moduleAccess.inbound && [context.role, ...(context.roles ?? [])].some((role) => role === "owner" || role === "producer" || role === "assistant");

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
        moduleAccess={moduleAccess}
        plan={plan}
      />
      {/* Opens the audio context on the first gesture. Mounted beside the bridge because the
          two together are the whole sound story on this plane: the bridge covers call sites
          not yet migrated, this primes the layer that governs the ones that are. */}
      <NotifySoundPrimer />
      {takesTransfers && <LiveTransferCard />}

      {/* min-w-0 is load-bearing, for the same reason it is on the admin shell: a flex item
          defaults to min-width:auto, so <main> refuses to shrink below its widest child and one
          wide table drags the whole page sideways.
          overflow-x-CLIP, not hidden: `hidden` makes <main> a scroll container, and the sticky top
          bar then sticks to a box that never scrolls — so it scrolled off with the page. */}
      <main className="min-w-0 flex-1 overflow-x-clip bg-[var(--color-page-bg)] flex flex-col">
        {/* The bar is chrome and always present. Below it, ordered by urgency: a platform-wide
            outage outranks a campaign announcement, which outranks a trial ending, which
            outranks an account already known to be read-only. */}
        {/* No context strip under the bar (removed 2026-09-28): the workspace, plan and role are in
            the account menu and the plan card, and the read-only and maintenance states it echoed
            are the banners just below, which say what to do about them. */}
        <AppTopBar user={identity} userId={context.userId} />
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
        {/* Louder than everything below it, and not dismissible (LA-6.4). */}
        {/* AG-0.5: complaints are the agency's, and their screen is refused to a narrowed session inside one. */}
        <OverdueComplaintBanner count={agencyNarrow ? 0 : overdueComplaints} />
        <MaintenanceMessage status={maintenance} />
        <AnnouncementStrip initialAnnouncements={announcements} />
        <SubscriptionStateBanner status={entitlement.status} isOwner={context.role === "owner"} />
        {/* The walkthrough's step bar, only on a screen opened with ?guide= from Get set up. */}
        <Suspense fallback={null}><SetupGuideBar /></Suspense>
        <PortalPageTransition>{children}</PortalPageTransition>
      </div>
      </main>
    </div>
  );
}

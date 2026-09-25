"use client";

import { TopBarShell, type TopBarUser } from "@/components/app/app-top-bar";
import { usePartnerTopBarFeed } from "@/components/partner/partner-alert-center";

/**
 * The partner bar: the same bar as the agent's, with the partner's own contents (p-nav-spec,
 * p-par-overview). Search covers what the organisation sent; the bell holds what is addressed to
 * this person; the triangle holds what is wrong with the organisation. The alert controls that used
 * to sit above every page title are the bar's preferences panel now, sound opt-in included.
 */
export function PartnerTopBar({ user }: { user: TopBarUser }) {
  const feed = usePartnerTopBarFeed();
  return (
    <TopBarShell
      user={user}
      feed={feed}
      searchEndpoint="/api/partner/search"
      searchPlaceholder="Search the leads you have sent…"
      searchScope="Search covers the leads your organisation has sent and the pages of this portal. Leads from other partners never appear here."
      profileHref="/partner/settings"
      profileLabel="Settings"
      profileHint="Your organisation's portal settings"
      signOutEndpoint="/api/partner/auth/logout"
      signOutRedirect="/partner/login"
    />
  );
}

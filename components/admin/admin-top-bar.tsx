"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TopBarShell, type TopBarAlert, type TopBarFeed, type TopBarNotification, type TopBarUser } from "@/components/app/app-top-bar";
import { notify } from "@/lib/notify";

/**
 * The staff bar (p-nav-admin): the same bar, with the platform's own contents.
 *
 * Alerts are platform state that is wrong right now — webhooks not processed, a compliance source
 * failing, maintenance on, the billing run unhealthy, subscriptions past due, customers at their
 * seat limit. Notifications are billing events addressed to billing staff — trials ending with no
 * card, plan changes, cancellations, early conversions. Both are read from state the platform
 * already keeps (lib/adminAlerts); each is shown only to a role that can open the page it links to.
 *
 * Not built, and why: staff have no per-person notification preferences stored anywhere, so no
 * preferences panel is drawn; and no staff alert centre exists, because staff alerts are computed
 * live — there is no history of resolved ones to list.
 */

type Feed = { alerts: TopBarAlert[]; notifications: TopBarNotification[]; readStateReady: boolean };

const POLL_MS = 30_000;

function useStaffFeed(): TopBarFeed {
  const [feed, setFeed] = useState<Feed>({ alerts: [], notifications: [], readStateReady: true });
  const inFlight = useRef(false);
  const cleared = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/admin/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as Feed;
      setFeed({ ...body, notifications: body.notifications.filter((item) => !cleared.current.has(item.id)) });
    } catch {
      // The next poll retries; the bar must never interrupt the page under it.
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [load]);

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    ids.forEach((id) => cleared.current.add(id));
    setFeed((current) => ({ ...current, notifications: current.notifications.filter((item) => !ids.includes(item.id)) }));
    try {
      const response = await fetch("/api/admin/notifications", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      if (!response.ok) throw new Error("mark read failed");
    } catch {
      ids.forEach((id) => cleared.current.delete(id));
      notify.fail("Those notifications could not be marked read. They will reappear on the next check.");
    }
  }, []);

  return {
    notifications: feed.notifications,
    alerts: feed.alerts,
    markRead,
    readStateUnavailable: feed.readStateReady ? null : "Read marks need a database update",
    preferences: null,
    preferencesHint: "",
    alertCentreHref: null,
    notificationsEmptyBody: "Trials ending with no card on file, plan changes, cancellations and early conversions appear here for billing staff.",
    alertsEmpty: {
      head: "Nothing is wrong with the platform",
      body: "Failing webhooks, compliance sources, maintenance, the billing run, past-due payments and seat limits appear here. They clear when fixed, not when read.",
    },
  };
}

export function AdminTopBar({ user }: { user: TopBarUser }) {
  const feed = useStaffFeed();
  return (
    <TopBarShell
      user={user}
      feed={feed}
      searchEndpoint="/api/admin/search"
      searchPlaceholder="Search tenants, users, invoices…"
      searchScope="Search covers every tenant, user and invoice, and the admin pages your role can open."
      /* No profile row: staff have no page of their own, and "Settings" pointed at /admin/settings,
         an alias of Advanced. p-adm-settings-alias keeps that alias out of every menu so the
         settings store has one entry (Platform > Advanced), and most staff roles could not open it. */
      signOutEndpoint="/api/admin/auth/logout"
      signOutRedirect="/admin/login"
    />
  );
}

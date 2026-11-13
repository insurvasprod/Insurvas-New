"use client";

import Link from "next/link";
import { TopBarShell, type TopBarFeed, type TopBarUser } from "@/components/app/app-top-bar";
import { NotificationCentrePanel, useBellCentre } from "@/components/app/agent-notification-centre";
import type { AgentAlert } from "@/lib/agentAlerts/useAgentAlertFeed";

/**
 * The agent top bar with sample data, for /design/top-bar (development only): the Inbox with an
 * urgent card, notifications and alerts, and the account menu, without a session. The real bar
 * (`AppTopBar`) draws the same `TopBarShell` from the live feed.
 */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const USER: TopBarUser = { name: "Demo Agent", email: "demo.agent@insurvas.test", roleLabel: "Owner", workspaceName: "Ellery & Fields" };

const PERSONAL: AgentAlert[] = [
  { id: "n1", title: "Transfer offered to you", body: "Minnie Hargrove · Final Expense · from the inbound floor", link: "/app/leads", event_type: "handoff_offered", created_at: ago(4) },
  { id: "n2", title: "Callback due at 3:30 PM", body: "Robert Ellis asked you to call back about Term Life", link: "/app/callbacks", event_type: "callback_due", created_at: ago(22) },
  { id: "n3", title: "Sam mentioned you", body: "“Can you take the Price file tomorrow?”", link: "/app/leads", event_type: "mentioned", created_at: ago(60 * 26) },
] as AgentAlert[];

export function TopBarShowcase({ alerts, urgent }: { alerts: boolean; urgent: boolean }) {
  const centre = useBellCentre(PERSONAL, "design-preview", async () => undefined);
  const feed: TopBarFeed = {
    renderNotifications: ({ close, openPreferences }) => <NotificationCentrePanel centre={centre} close={close} openPreferences={openPreferences} />,
    urgent: urgent
      ? [{ id: "overdue-regulator-complaint", text: "Complaint past its deadline", detail: "Your licence is at risk.", href: "/app/complaints", action: "Respond" }]
      : [],
    notifications: PERSONAL.filter((item) => centre.badgeIds.has(item.id)),
    alerts: alerts
      ? [
        { id: "a1", title: "8 leads unclaimed for over 15 minutes", body: "Inbound queue · Final Expense", link: "/app/leads", actionLabel: "Claim leads", severity: "warning" },
        { id: "a2", title: "Escalation waiting on a manager", body: "Dana Price · Whole Life · 32 minutes", link: "/app/alerts", actionLabel: "Open the alert centre", severity: "critical" },
      ]
      : [],
    markRead: () => undefined,
    preferences: <p className="p-4 text-sm text-muted-foreground">Preferences appear here.</p>,
    preferencesHint: "Which events reach you, and how",
    alertCentreHref: "/app/alerts",
    notificationsEmptyBody: "Handoffs, mentions, partner messages and callbacks due appear here as they happen.",
    alertsEmpty: { head: "All clear", body: "Nothing needs you right now. Alerts clear on their own once the work is done." },
  };
  return (
    <TopBarShell
      user={USER}
      feed={feed}
      searchEndpoint="/api/app/search"
      searchPlaceholder="Search or jump to…"
      searchScope="Sample data."
      profileHref="/app/settings#my-profile"
      profileLabel="Your profile"
      profileHint="Name, phone, licence numbers"
      helpHref="/app/docs"
      signOutEndpoint="/api/app/auth/logout"
      signOutRedirect="/app/login"
      accountExtra={
        <div className="portal-top-plan">
          <span>
            <span className="portal-top-plan-label">Plan · 25 seats</span>
            <span className="portal-top-plan-name">Advance Team (QA demo)</span>
          </span>
          <Link href="/app/settings#billing" className="portal-top-plan-link">Manage</Link>
        </div>
      }
      inbox
    />
  );
}

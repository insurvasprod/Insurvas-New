import { Suspense, type ReactNode } from "react";

import { EmptyState } from "@/components/ui/page-states";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { pageLink } from "@/lib/adminDashboard/series";

import { GraphCardLoading } from "./ov-card";
import {
  ActiveCustomersGraph,
  CollectedGraph,
  FunnelGraph,
  MovementGraph,
  MrrGraph,
  NewLostGraph,
  PlansGraph,
  SignInsGraph,
  TrialsGraph,
} from "./ov-graphs";
import type { DashboardAdmin } from "./types";

/**
 * Admin dashboard › Overview (admin round 1, docs/design/admin-r1/dashboard-combined.html section 1): all
 * graphs, four to a row on a wide screen, each with its headline figure above its trend and linking to the tab
 * or page that explains it. Their period (30 days · 90 days · 12 months) is the filter button on the page's title
 * line (app/admin/(protected)/page.tsx), in the address.
 *
 * A role sees only the graphs whose pages it can open: money (MRR, how it moved, collected, plans) for the
 * roles that open Revenue; customers and the funnel for the roles that open Customers; trials for Trials;
 * sign-ins for Login activity. Each graph streams in its own Suspense and fails on its own.
 */
/** Whether the role sees any Overview graph, so the page offers the period filter only when it changes something. */
export function overviewHasGraphs(role: AdminRole): boolean {
  return ["/admin/revenue", "/admin/tenants", "/admin/trials", "/admin/activity"].some((href) => Boolean(pageLink(role, href)));
}

export async function OverviewTab({ admin }: { admin: DashboardAdmin }) {
  const role = admin.role;
  const money = Boolean(pageLink(role, "/admin/revenue"));
  const customers = Boolean(pageLink(role, "/admin/tenants"));
  const trials = Boolean(pageLink(role, "/admin/trials"));
  const signIns = Boolean(pageLink(role, "/admin/activity"));

  const cards: { key: string; title: string; span?: boolean; node: ReactNode }[] = [
    ...(money ? [{ key: "mrr", title: "MRR", span: true, node: <MrrGraph role={role} /> }, { key: "moved", title: "How MRR moved", span: true, node: <MovementGraph role={role} /> }] : []),
    ...(customers ? [{ key: "active", title: "Active customers", node: <ActiveCustomersGraph role={role} /> }, { key: "new-lost", title: "New vs lost customers", node: <NewLostGraph role={role} /> }] : []),
    ...(money ? [{ key: "collected", title: "Collected", node: <CollectedGraph role={role} /> }] : []),
    ...(trials ? [{ key: "trials", title: "Trials in flight", node: <TrialsGraph role={role} /> }] : []),
    ...(money ? [{ key: "plans", title: "Customers & MRR by plan", span: true, node: <PlansGraph role={role} /> }] : []),
    ...(customers ? [{ key: "funnel", title: "Sign-up funnel", node: <FunnelGraph role={role} /> }] : []),
    ...(signIns ? [{ key: "sign-ins", title: "Sign-ins per day", node: <SignInsGraph role={role} /> }] : []),
  ];

  if (!cards.length) {
    return (
      <EmptyState
        title="No graphs for your role"
        hint="The graphs show money, customers and sign-ins, which your role does not open. Needs you and Platform health have your checks."
      />
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Suspense key={card.key} fallback={<GraphCardLoading title={card.title} span={card.span} />}>
          {card.node}
        </Suspense>
      ))}
    </div>
  );
}

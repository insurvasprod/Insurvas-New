import { Suspense } from "react";
import { notFound } from "next/navigation";

import { AgencyDashboard } from "@/components/app/agency/agency-dashboard";
import { AgentSidebar } from "@/components/app/agent-sidebar";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { buildAgentMenu, menuFeatureKeys } from "@/lib/menu/definition";
import {
  SAMPLE_AGENCY_ROLES,
  SAMPLE_AGENCY_STATES,
  sampleAgencyDashboard,
  type SampleAgencyRole,
  type SampleAgencyState,
} from "@/lib/agency/fixtures";

export const metadata = { title: "Agency dashboard · Insurvas design system" };

/**
 * The agency dashboard on sample data, in the real agent frame (sidebar, stage, page padding).
 *
 * The agency this app runs against has one seat, no producers and no ledger — every figure on it
 * is a legitimate zero, which makes it the worst possible thing to redesign against. This is the
 * only place the page can be seen busy, quiet, empty or erroring, as an owner and as a manager
 * scoped to their own reports.
 *
 *   ?state=busy|quiet|empty|error   ?role=owner|manager
 *
 * Development only. Check a change here at 1536×826, 1366×657 and 375 wide before calling it done.
 */
export default async function AgencyDesignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const state = (SAMPLE_AGENCY_STATES as readonly string[]).includes(one("state") ?? "") ? (one("state") as SampleAgencyState) : "busy";
  const role = (SAMPLE_AGENCY_ROLES as readonly string[]).includes(one("role") ?? "") ? (one("role") as SampleAgencyRole) : "owner";

  const data = state === "error" ? null : sampleAgencyDashboard({ state, role });
  const before = state === "error" || state === "empty" ? null : sampleAgencyDashboard({ state, role, previous: true });
  const menu = buildAgentMenu(menuFeatureKeys(), "owner");

  const href = (next: Partial<{ state: string; role: string }>) =>
    `/design/agency?state=${next.state ?? state}&role=${next.role ?? role}`;
  const pill = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs no-underline ${active ? "bg-[var(--surface-alt)] font-semibold text-foreground" : "hover:bg-[var(--surface-alt)]"}`;

  return (
    <div className="portal-agent flex min-h-screen flex-col md:flex-row">
      <AgentSidebar menu={menu} moduleAccess={{ inbound: true, outbound: true }} plan={{ name: "Agency 50", seats: 25, roleLabel: "Owner", isOwner: true }} />
      <main className="flex min-w-0 flex-1 flex-col overflow-x-clip bg-[var(--color-page-bg)]">
        <div className="sticky top-0 z-30 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-[var(--surface)] px-4 py-2 text-sm text-muted-foreground sm:px-6">
          <span className="font-semibold text-foreground">Agency dashboard preview</span>
          <span className="flex flex-wrap items-center gap-1">
            {SAMPLE_AGENCY_STATES.map((item) => <a key={item} href={href({ state: item })} className={pill(item === state)}>{item}</a>)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="flex flex-wrap items-center gap-1">
            {SAMPLE_AGENCY_ROLES.map((item) => <a key={item} href={href({ role: item })} className={pill(item === role)}>{item}</a>)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
          <DashboardStage className="flex min-w-0 flex-1 flex-col">
            <Suspense>
              <AgencyDashboard
                key={`${state}-${role}`}
                agencyName="Northstar Insurance Group"
                scoped={role === "manager"}
                preview={{ data, previous: before, error: state === "error" ? "The agency dashboard could not be read." : undefined }}
              />
            </Suspense>
          </DashboardStage>
        </div>
      </main>
    </div>
  );
}

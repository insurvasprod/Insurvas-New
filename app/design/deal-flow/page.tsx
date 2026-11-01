import { Suspense } from "react";
import { notFound } from "next/navigation";

import { PartnerDealFlow } from "@/components/partner/partner-deal-flow";
import { PartnerSidebar } from "@/components/partner/partner-sidebar";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import {
  SAMPLE_DAY,
  SAMPLE_DEAL_FLOW_ROLES,
  SAMPLE_DEAL_FLOW_STATES,
  sampleDealFlow,
  type SampleDealFlowRole,
  type SampleDealFlowState,
} from "@/lib/partnerDealFlow/fixtures";

export const metadata = { title: "Daily deal flow · Insurvas design system" };

/**
 * The partner Daily deal flow on sample data, in the real partner frame (sidebar, stage, page
 * padding). The development database holds one lead and no worked deals, so this is the only place
 * the page can be seen busy, quiet, empty or erroring, for either role.
 *
 *   ?state=busy|quiet|empty|error   ?role=partner_admin|partner_user   ?day=YYYY-MM-DD   ?filters=open
 *
 * Development only. Check a change here at 1536×826, 1366×657 and 375 wide before calling it done.
 */
export default async function DealFlowDesignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const state = (SAMPLE_DEAL_FLOW_STATES as readonly string[]).includes(one("state") ?? "") ? (one("state") as SampleDealFlowState) : "busy";
  const role = (SAMPLE_DEAL_FLOW_ROLES as readonly string[]).includes(one("role") ?? "") ? (one("role") as SampleDealFlowRole) : "partner_admin";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(one("day") ?? "") ? (one("day") as string) : SAMPLE_DAY;
  const filtersOpen = one("filters") === "open";

  const data = state === "error" ? null : sampleDealFlow({ state, role, day });

  const href = (next: Partial<{ state: string; role: string }>) =>
    `/design/deal-flow?state=${next.state ?? state}&role=${next.role ?? role}&day=${day}`;
  const pill = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs no-underline ${active ? "bg-[var(--surface-alt)] font-semibold text-foreground" : "hover:bg-[var(--surface-alt)]"}`;

  return (
    <div className="portal-agent portal-partner min-h-screen">
      <PartnerSidebar role={role} partnerStatus="active" partnerName="Sample Publishing Co." />
      <main className="min-w-0 flex-1 overflow-x-clip bg-[var(--color-page-bg)] flex flex-col">
        <div className="sticky top-0 z-30 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-[var(--surface)] px-4 py-2 text-sm text-muted-foreground sm:px-6">
          <span className="font-semibold text-foreground">Daily deal flow preview</span>
          <span className="flex flex-wrap items-center gap-1">
            {SAMPLE_DEAL_FLOW_STATES.map((item) => <a key={item} href={href({ state: item })} className={pill(item === state)}>{item}</a>)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="flex flex-wrap items-center gap-1">
            {SAMPLE_DEAL_FLOW_ROLES.map((item) => <a key={item} href={href({ role: item })} className={pill(item === role)}>{item === "partner_admin" ? "admin" : "user"}</a>)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
          <DashboardStage className="flex min-w-0 flex-1 flex-col">
            <Suspense>
              <PartnerDealFlow
                key={`${state}-${role}-${day}-${filtersOpen}`}
                role={role}
                initialFrom={day}
                initialTo={day}
                today={SAMPLE_DAY}
                initialFiltersOpen={filtersOpen}
                preview={{ data, error: state === "error" ? "Could not load the daily deal flow" : undefined }}
              />
            </Suspense>
          </DashboardStage>
        </div>
      </main>
    </div>
  );
}

import { notFound } from "next/navigation";

import { PartnerPortalOverview } from "@/components/partner/partner-portal-overview";
import { PartnerSidebar } from "@/components/partner/partner-sidebar";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { SAMPLE_OVERVIEW_STATES, SAMPLE_PAYOUTS, SAMPLE_ROLES, sampleOverview, type SampleOverviewState, type SamplePayout, type SampleRole } from "@/lib/partnerLeads/fixtures";

export const metadata = { title: "Overview · Insurvas design system" };

/**
 * The partner Overview on sample data, in the real partner frame.
 *
 * The charts are the point of this preview: the development database holds one lead submitted
 * today, so a thirty-day series there is one bar and proves nothing. Here the window is busy,
 * quiet, empty, or failed to read — which are four different pages, and all four should be worth
 * looking at.
 *
 *   ?state=busy|quiet|empty|error   ?role=partner_admin|partner_user   ?payout=per_sale|revenue_share|none
 *
 * Development only. Check a change here at 1536×826, 1366×657 and 375 wide before calling it done.
 */
export default async function OverviewDesignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const state = (SAMPLE_OVERVIEW_STATES as readonly string[]).includes(one("state") ?? "") ? (one("state") as SampleOverviewState) : "busy";
  const role = (SAMPLE_ROLES as readonly string[]).includes(one("role") ?? "") ? (one("role") as SampleRole) : "partner_admin";
  const payout = (SAMPLE_PAYOUTS as readonly string[]).includes(one("payout") ?? "") ? (one("payout") as SamplePayout) : "per_sale";

  const sample = sampleOverview({ state, role, payout });

  const href = (next: Partial<{ state: string; role: string; payout: string }>) =>
    `/design/overview?state=${next.state ?? state}&role=${next.role ?? role}&payout=${next.payout ?? payout}`;
  const pill = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs no-underline ${active ? "bg-[var(--surface-alt)] font-semibold text-foreground" : "hover:bg-[var(--surface-alt)]"}`;

  return (
    <div className="portal-agent portal-partner min-h-screen">
      <PartnerSidebar role={role} partnerStatus="active" partnerName="Sample Publishing Co." />
      <main className="min-w-0 flex-1 overflow-x-clip bg-[var(--color-page-bg)] flex flex-col">
        <div className="portal-top-bar flex h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-[var(--surface)] px-6 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Overview preview</span>
          <span className="flex items-center gap-1">
            {SAMPLE_OVERVIEW_STATES.map((item) => <a key={item} href={href({ state: item })} className={pill(item === state)}>{item}</a>)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="flex items-center gap-1">
            {SAMPLE_ROLES.map((item) => <a key={item} href={href({ role: item })} className={pill(item === role)}>{item === "partner_admin" ? "admin" : "user"}</a>)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="flex items-center gap-1">
            {SAMPLE_PAYOUTS.map((item) => <a key={item} href={href({ payout: item })} className={pill(item === payout)}>{item}</a>)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
          <DashboardStage className="flex min-w-0 flex-1 flex-col">
            <PartnerPortalOverview key={`${state}-${role}-${payout}`} role={role} partnerStatus="active" sample={sample} />
          </DashboardStage>
        </div>
      </main>
    </div>
  );
}

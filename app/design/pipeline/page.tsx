import { Suspense } from "react";
import { notFound } from "next/navigation";

import { PartnerLeadPipeline } from "@/components/partner/partner-lead-pipeline";
import { PartnerSidebar } from "@/components/partner/partner-sidebar";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { SAMPLE_PAYOUTS, SAMPLE_ROLES, SAMPLE_STATES, samplePipeline, type SamplePayout, type SampleRole, type SampleState } from "@/lib/partnerLeads/fixtures";

export const metadata = { title: "Pipeline · Insurvas design system" };

/**
 * The partner Pipeline page on sample data, in the real partner frame (sidebar, stage, page
 * padding). The development database holds one lead in one stage, so this is the only place the
 * page can be seen busy, empty, erroring, or with a submission the SLA ladder has flagged.
 *
 *   ?state=busy|quiet|sla|many|empty|error   ?role=partner_admin|partner_user   ?payout=per_sale|revenue_share|none
 *
 * Development only. Check a change here at 1536×826, 1366×657 and 375 wide before calling it done.
 */
export default async function PipelineDesignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const state = (SAMPLE_STATES as readonly string[]).includes(one("state") ?? "") ? (one("state") as SampleState) : "busy";
  const role = (SAMPLE_ROLES as readonly string[]).includes(one("role") ?? "") ? (one("role") as SampleRole) : "partner_admin";
  const payout = (SAMPLE_PAYOUTS as readonly string[]).includes(one("payout") ?? "") ? (one("payout") as SamplePayout) : "per_sale";

  const data = state === "error" ? null : samplePipeline({ state, role, payout });

  const href = (next: Partial<{ state: string; role: string; payout: string }>) =>
    `/design/pipeline?state=${next.state ?? state}&role=${next.role ?? role}&payout=${next.payout ?? payout}`;
  const pill = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs no-underline ${active ? "bg-[var(--surface-alt)] font-semibold text-foreground" : "hover:bg-[var(--surface-alt)]"}`;

  return (
    <div className="portal-agent portal-partner min-h-screen">
      <PartnerSidebar role={role} partnerStatus="active" partnerName="Sample Publishing Co." />
      <main className="min-w-0 flex-1 overflow-x-clip bg-[var(--color-page-bg)] flex flex-col">
        <div className="portal-top-bar flex h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-[var(--surface)] px-6 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Pipeline preview</span>
          <span className="flex items-center gap-1">
            {SAMPLE_STATES.map((item) => <a key={item} href={href({ state: item })} className={pill(item === state)}>{item}</a>)}
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
            <Suspense>
              <PartnerLeadPipeline
                key={`${state}-${role}-${payout}`}
                role={role}
                partnerStatus="active"
                partnerName="Sample Publishing Co."
                preview={{ data, error: state === "error" ? "Could not load your lead pipeline" : undefined }}
              />
            </Suspense>
          </DashboardStage>
        </div>
      </main>
    </div>
  );
}

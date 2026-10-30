import { notFound } from "next/navigation";

import { PartnerPayouts } from "@/components/partner/partner-payouts";
import { PartnerSidebar } from "@/components/partner/partner-sidebar";
import { PartnerTeamReviewWorkspace } from "@/components/partner/partner-team-review-workspace";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { SAMPLE_OVERVIEW_STATES, sampleOrganization, type SampleOverviewState } from "@/lib/partnerLeads/fixtures";

export const metadata = { title: "Organization · Insurvas design system" };

const BOARDS = ["review", "statements"] as const;
type Board = (typeof BOARDS)[number];

/**
 * The Organization boards that have figures in them, on sample data.
 *
 * Team review ranks a team and draws a trend; Statements lists months of money. The development
 * database has one lead and no published statement, so neither can be seen doing its job there.
 * Team access and Settings are not here: their change was swapping three stat tiles for the shared
 * cards, and adding an (i) — nothing a fixture would show that the component itself does not.
 *
 *   ?board=review|statements   ?state=busy|quiet|empty|error
 *
 * Development only. Check a change here at 1536×826 and 375 wide before calling it done.
 */
export default async function OrganizationDesignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const board = (BOARDS as readonly string[]).includes(one("board") ?? "") ? (one("board") as Board) : "review";
  const state = (SAMPLE_OVERVIEW_STATES as readonly string[]).includes(one("state") ?? "") ? (one("state") as SampleOverviewState) : "busy";

  const sample = sampleOrganization({ state });

  const href = (next: Partial<{ board: string; state: string }>) => `/design/organization?board=${next.board ?? board}&state=${next.state ?? state}`;
  const pill = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs no-underline ${active ? "bg-[var(--surface-alt)] font-semibold text-foreground" : "hover:bg-[var(--surface-alt)]"}`;

  return (
    <div className="portal-agent portal-partner min-h-screen">
      <PartnerSidebar role="partner_admin" partnerStatus="active" partnerName="Sample Publishing Co." />
      <main className="min-w-0 flex-1 overflow-x-clip bg-[var(--color-page-bg)] flex flex-col">
        <div className="portal-top-bar flex h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-[var(--surface)] px-6 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Organization preview</span>
          <span className="flex items-center gap-1">
            {BOARDS.map((item) => <a key={item} href={href({ board: item })} className={pill(item === board)}>{item}</a>)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="flex items-center gap-1">
            {SAMPLE_OVERVIEW_STATES.map((item) => <a key={item} href={href({ state: item })} className={pill(item === state)}>{item}</a>)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
          <DashboardStage className="flex min-w-0 flex-1 flex-col">
            {board === "review"
              ? <PartnerTeamReviewWorkspace key={state} partnerName="Sample Publishing Co." sample={sample.review} />
              : <div className="m-stagger space-y-6"><PartnerPayouts key={state} sample={sample.statements} /></div>}
          </DashboardStage>
        </div>
      </main>
    </div>
  );
}

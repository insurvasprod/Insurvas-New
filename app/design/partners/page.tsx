import { Suspense } from "react";
import { notFound } from "next/navigation";

import { AgentSidebar } from "@/components/app/agent-sidebar";
import { PartnersPreview } from "@/components/design/partners-preview";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { buildAgentMenu, menuFeatureKeys } from "@/lib/menu/definition";
import { PREVIEW_STATES } from "@/lib/settings/preview/fixtures";

export const metadata = { title: "Partners · Insurvas design system" };

/**
 * The Partners pages on sample data, in the real app frame (sidebar, stage). ?id=p-apex opens one
 * partner's record; ?state=empty|error|readonly. Development only.
 */
export default async function PartnersDesignPage({ searchParams }: { searchParams: Promise<{ id?: string; state?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { id, state: requested } = await searchParams;
  const state = PREVIEW_STATES.find((item) => item === requested) ?? "loaded";
  const menu = buildAgentMenu(menuFeatureKeys(), "owner");
  return (
    <div className="portal-agent flex min-h-screen flex-col md:flex-row">
      <AgentSidebar menu={menu} moduleAccess={{ inbound: true, outbound: true }} plan={{ name: "Advanced", seats: 10, roleLabel: "Owner", isOwner: true }} />
      <main className="flex min-w-0 flex-1 flex-col overflow-x-clip bg-[var(--color-page-bg)]">
        <div className="portal-top-bar flex h-14 shrink-0 items-center gap-3 border-b border-border bg-[var(--surface)] px-6 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Partners preview</span>
          <a href="/design/partners" className="rounded-md px-2 py-1 no-underline hover:bg-[var(--surface-alt)]">List</a>
          <a href="/design/partners?id=p-apex" className="rounded-md px-2 py-1 no-underline hover:bg-[var(--surface-alt)]">A partner&apos;s record</a>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
          <DashboardStage className="flex min-w-0 flex-1 flex-col">
            <Suspense>
              <PartnersPreview key={`${id ?? "list"}-${state}`} id={id} state={state} />
            </Suspense>
          </DashboardStage>
        </div>
      </main>
    </div>
  );
}

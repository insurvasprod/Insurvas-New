import { notFound } from "next/navigation";

import { AgentSidebar } from "@/components/app/agent-sidebar";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import { PageHeader } from "@/components/ui/page-header";
import { buildAgentMenu, menuFeatureKeys } from "@/lib/menu/definition";

export const metadata = { title: "App shell · Insurvas design system" };

/**
 * The agent app's real sidebar with an owner's full menu, beside a page that draws its own breadcrumb
 * and title (manager review 28 Oct §3: sub-navigation, breadcrumb on the page, one account menu).
 * Development only; nothing here reads an account.
 */
export default function ShellDesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const menu = buildAgentMenu(menuFeatureKeys(), "owner");
  return (
    <div className="portal-agent flex min-h-screen flex-col md:flex-row">
      <AgentSidebar menu={menu} moduleAccess={{ inbound: true, outbound: true }} plan={{ name: "Advanced", seats: 10, roleLabel: "Owner", isOwner: true }} />
      <main className="flex min-w-0 flex-1 flex-col overflow-x-clip bg-[var(--color-page-bg)]">
        <div className="portal-top-bar flex h-14 shrink-0 items-center gap-3 border-b border-border bg-[var(--surface)] px-6 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Shell preview</span>
          <span>Top bar stand-in: search, New, notifications and the one account menu live here.</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
          <DashboardStage className="flex min-w-0 flex-1 flex-col">
            <PageHeader visible title="Publishers" description="The partners who send you leads and live transfers." breadcrumbs={[{ label: "Partners", href: "/app/partners" }, { label: "Publishers" }]} />
          </DashboardStage>
        </div>
      </main>
    </div>
  );
}

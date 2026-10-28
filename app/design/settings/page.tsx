import Link from "next/link";
import { notFound } from "next/navigation";

import { SettingsPreview } from "@/components/design/settings-preview";
import { DashboardStage } from "@/components/ui/dashboard-stage";
import type { TenantRole } from "@/lib/tenantAuth/roles";

export const metadata = { title: "Settings · Insurvas design system" };

const ROLES: TenantRole[] = ["owner", "producer", "bookkeeper"];

/**
 * The one Settings layout (tasks/settings-shell-plan.md, Task 4), from sample panels, for approval
 * before every Settings page moves to it. The frame, header, breadcrumb and menu are the real
 * components; a 280px sidebar and the 56px top bar are stood in so the content is as wide as in the
 * app. Development only.   ?role=owner|producer|bookkeeper   then pick a section, or open #carriers.
 */
export default async function SettingsDesignPage({ searchParams }: { searchParams: Promise<{ role?: string; route?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { role: requested, route } = await searchParams;
  const role = ROLES.find((item) => item === requested) ?? "owner";
  return (
    <div className="portal-agent flex min-h-screen bg-[var(--color-page-bg)]">
      {/* Stand-ins for the real sidebar (280px) and top bar (56px), so widths match the app. */}
      <aside aria-hidden="true" className="hidden w-[280px] shrink-0 border-r border-border bg-[var(--surface)] lg:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="portal-top-bar flex h-14 shrink-0 items-center gap-3 border-b border-border bg-[var(--surface)] px-6 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Settings preview</span>
          {ROLES.map((item) => (
            <Link key={item} href={`/design/settings?role=${item}`} aria-current={item === role ? "page" : undefined} className="rounded-md px-2 py-1 capitalize no-underline aria-[current=page]:bg-[var(--surface-alt)] aria-[current=page]:text-foreground">{item}</Link>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
          <DashboardStage className="flex min-w-0 flex-1 flex-col">
            <div className="portal-settings-page flex flex-col gap-6">
              <SettingsPreview key={`${role}-${route ?? ""}`} role={role} routeSection={route} />
            </div>
          </DashboardStage>
        </div>
      </div>
    </div>
  );
}

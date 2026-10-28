import { notFound } from "next/navigation";

import { SettingsPatternsPreview } from "@/components/design/settings-patterns";
import { DashboardStage } from "@/components/ui/dashboard-stage";

export const metadata = { title: "Settings patterns · Insurvas design system" };

/**
 * R3 · the Settings content patterns, inside the real Settings frame (open #patterns). The same
 * stand-ins as /design/settings for the 280px sidebar and 56px top bar, so widths match the app.
 * Development only.
 */
export default function SettingsPatternsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="portal-agent flex min-h-screen bg-[var(--color-page-bg)]">
      <aside aria-hidden="true" className="hidden w-[280px] shrink-0 border-r border-border bg-[var(--surface)] lg:block" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="portal-top-bar flex h-14 shrink-0 items-center gap-3 border-b border-border bg-[var(--surface)] px-6 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Settings patterns (R3)</span>
          <span>Open “Settings patterns” at the end of the menu.</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
          <DashboardStage className="flex min-w-0 flex-1 flex-col">
            <div className="portal-settings-page flex flex-col gap-6">
              <SettingsPatternsPreview />
            </div>
          </DashboardStage>
        </div>
      </div>
    </div>
  );
}

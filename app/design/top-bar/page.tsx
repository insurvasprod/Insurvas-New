import { notFound } from "next/navigation";

import { TopBarShowcase } from "@/components/design/top-bar-showcase";

export const metadata = { title: "Top bar · Insurvas design system" };

/**
 * The agent top bar's Inbox and account menu with sample data (owner, 2026-11-13 redesign).
 * `?alerts=0` shows the Alerts tab with only the urgent card; `?urgent=0` drops the urgent card.
 * Development only; nothing here reads an account.
 */
export default async function TopBarDesignPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  return (
    <div className="portal-agent flex min-h-screen">
      <main className="flex min-w-0 flex-1 flex-col bg-[var(--color-page-bg)]">
        <TopBarShowcase alerts={params.alerts !== "0"} urgent={params.urgent !== "0"} />
      </main>
    </div>
  );
}

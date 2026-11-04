import { ViewTabs } from "@/components/ui/view-tabs";
import { setupTabCounts } from "@/lib/pipelineRules/setupCounts";

/**
 * Book of business › Setup (board 8 of docs/la4/mockups-r5/book-commissions-r5.html): five tabs that fit. Every
 * tab is its own address under /app/book-setup, so a link, an alert or an email lands on the right one. Files in
 * holds two sections, How files arrive and Bring your existing book; its address is the one How files arrive
 * already had, and /app/book-import (the onboarding import) renders the same tab.
 */
export type SetupTab = "rate-card" | "carrier-rules" | "pipeline-rules" | "agent-codes" | "files-in";

export const SETUP_TABS: ReadonlyArray<{ key: SetupTab; label: string; href: string }> = [
  { key: "rate-card", label: "Rate card", href: "/app/book-setup" },
  { key: "carrier-rules", label: "Carrier rules", href: "/app/book-setup/carrier-rules" },
  { key: "pipeline-rules", label: "Pipeline rules", href: "/app/book-setup/pipeline-rules" },
  { key: "agent-codes", label: "Agent codes", href: "/app/book-setup/agent-codes" },
  { key: "files-in", label: "Files in", href: "/app/book-setup/how-files-arrive" },
];

/**
 * The tab bar, for DataInPage's `lead`. Each count is what is missing on that tab (rates, windows, codes to map),
 * read the same way on every tab (lib/pipelineRules/setupCounts.ts); nothing missing, or a count that cannot be
 * read, shows no count.
 */
export async function SetupTabs({ active, tenantId }: { active: SetupTab; tenantId: string }) {
  const counts = await setupTabCounts(tenantId);
  const count = (key: SetupTab) => (key === "rate-card" || key === "carrier-rules" || key === "agent-codes" ? counts[key] : null);
  return (
    <ViewTabs<SetupTab>
      label="Setup"
      value={active}
      tabs={SETUP_TABS.map((tab) => ({ key: tab.key, label: tab.label, href: tab.href, count: count(tab.key) || undefined, tone: "danger" }))}
    />
  );
}

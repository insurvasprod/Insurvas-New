import { ViewTabs } from "@/components/ui/view-tabs";

/**
 * Book of business › Setup (owner 2026-11-02, round 2): the rules the engine follows, one tab each. Every
 * tab is its own address under /app/book-setup, so a link, an alert or an email lands on the right one;
 * "Bring your existing book" is the onboarding import at /app/book-import, which already opens in Setup.
 */
export type SetupTab = "rate-card" | "carrier-rules" | "pipeline-rules" | "agent-codes" | "existing-book";

export const SETUP_TABS: ReadonlyArray<{ key: SetupTab; label: string; href: string }> = [
  { key: "rate-card", label: "Rate card", href: "/app/book-setup" },
  { key: "carrier-rules", label: "Carrier rules", href: "/app/book-setup/carrier-rules" },
  { key: "pipeline-rules", label: "Pipeline rules", href: "/app/book-setup/pipeline-rules" },
  { key: "agent-codes", label: "Agent codes", href: "/app/book-setup/agent-codes" },
  { key: "existing-book", label: "Bring your existing book", href: "/app/book-import" },
];

/** The tab bar, for DataInPage's `lead`. A count is shown where something waits (carrier rules missing, codes to map). */
export function SetupTabs({ active, counts = {} }: { active: SetupTab; counts?: Partial<Record<SetupTab, number | null>> }) {
  return (
    <ViewTabs<SetupTab>
      label="Setup"
      value={active}
      tabs={SETUP_TABS.map((tab) => ({ key: tab.key, label: tab.label, href: tab.href, count: counts[tab.key] ?? undefined, tone: tab.key === "agent-codes" || tab.key === "carrier-rules" ? "danger" : undefined }))}
    />
  );
}

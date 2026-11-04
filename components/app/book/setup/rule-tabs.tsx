import { ViewTabs } from "@/components/ui/view-tabs";

export type RuleTab = "rule" | "preview" | "forecast" | "versions";

/**
 * A rule's parts (board BobE7): Rule · Preview · Forecast · Versions, each its own address (?tab=). Link tabs
 * on the title line (the page's `lead`, UI-CONSISTENCY §8a), so no hooks: the server page draws them.
 */
export function RuleTabs({ active, base, counts }: { active: RuleTab; base: string; counts: Partial<Record<RuleTab, number>> }) {
  const tabs: Array<{ key: RuleTab; label: string; count?: number; href: string }> = [
    { key: "rule", label: "Rule", href: base },
    { key: "preview", label: "Preview", count: counts.preview, href: `${base}?tab=preview` },
    { key: "forecast", label: "Forecast", count: counts.forecast, href: `${base}?tab=forecast` },
    { key: "versions", label: "Versions", count: counts.versions, href: `${base}?tab=versions` },
  ];
  return <ViewTabs label="Rule" tabs={tabs} value={active} />;
}

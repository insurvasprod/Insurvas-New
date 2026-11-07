import { ViewTabs } from "@/components/ui/view-tabs";

export type RuleTab = "overview" | "check" | "rule" | "versions";

/** Old addresses (?tab=preview, ?tab=forecast) open Check it, where both live now (round 6, direction F). */
export function ruleTabOf(asked: string | undefined): RuleTab {
  if (asked === "preview" || asked === "forecast") return "check";
  return asked === "check" || asked === "rule" || asked === "versions" ? asked : "overview";
}

/**
 * A rule's parts (round 6, docs/la4/mockups-r6/pipeline-rule-r2.html direction F): Overview (where the rule is in its
 * life and what is left) · Check it (the would-moves to mark, and today's preview) · Rule (the form) · Versions. Each
 * its own address (?tab=); link tabs on the title line (UI-CONSISTENCY §8a), drawn by the server page.
 */
export function RuleTabs({ active, base, counts }: { active: RuleTab; base: string; counts: Partial<Record<RuleTab, number>>; warnCheck?: boolean }) {
  const tabs: Array<{ key: RuleTab; label: string; count?: number; href: string }> = [
    { key: "overview", label: "Overview", href: base },
    { key: "check", label: "Check it", count: counts.check, href: `${base}?tab=check` },
    { key: "rule", label: "Rule", href: `${base}?tab=rule` },
    { key: "versions", label: "Versions", count: counts.versions, href: `${base}?tab=versions` },
  ];
  return <ViewTabs label="Rule" tabs={tabs} value={active} />;
}

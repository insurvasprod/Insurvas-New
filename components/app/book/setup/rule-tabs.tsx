import { ViewTabs } from "@/components/ui/view-tabs";

import { rulePageHref, type RuleBucket } from "./card-moves-shared";

export type RuleTab = "overview" | "check" | "rule" | "versions";

/** Old addresses (?tab=preview, ?tab=forecast) open Check it, where both live now (round 6, direction F). */
export function ruleTabOf(asked: string | undefined): RuleTab {
  if (asked === "preview" || asked === "forecast") return "check";
  return asked === "check" || asked === "rule" || asked === "versions" ? asked : "overview";
}

/**
 * A rule's parts (round 6 direction F, kept by r7 §2·1): Overview (where the rule is in its life and what is left) ·
 * Check it (the would-moves to mark; its count is the ones not checked yet, red while any wait) · Rule (the form) ·
 * Versions. Each its own address (?tab=), keeping the list tab it was opened from (?from=) for the stepper; link tabs
 * on the title line (UI-CONSISTENCY §8b), drawn by the server page.
 */
export function RuleTabs({ active, ruleId, from, counts, warnCheck = false }: { active: RuleTab; ruleId: string; from: RuleBucket | null; counts: Partial<Record<RuleTab, number>>; warnCheck?: boolean }) {
  const href = (tab: RuleTab) => rulePageHref(ruleId, { from, tab });
  const tabs: Array<{ key: RuleTab; label: string; count?: number; tone?: "danger"; href: string }> = [
    { key: "overview", label: "Overview", href: href("overview") },
    { key: "check", label: "Check it", count: counts.check, tone: warnCheck ? "danger" : undefined, href: href("check") },
    { key: "rule", label: "Rule", href: href("rule") },
    { key: "versions", label: "Versions", count: counts.versions, href: href("versions") },
  ];
  return <ViewTabs label="Rule" tabs={tabs} value={active} />;
}

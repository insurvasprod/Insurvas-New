"use client";

import { usePathname, useRouter } from "next/navigation";

import { UnderlineTabs } from "@/components/ui/view-tabs";

export type RuleTab = "rule" | "preview" | "forecast" | "versions";

/** A rule's parts (board BobE7): Rule · Preview · Forecast · Versions, each its own address (?tab=). */
export function RuleTabs({ active, counts }: { active: RuleTab; counts: Partial<Record<RuleTab, number>> }) {
  const router = useRouter();
  const path = usePathname();
  const tabs: Array<{ key: RuleTab; label: string; count?: number }> = [
    { key: "rule", label: "Rule" },
    { key: "preview", label: "Preview", count: counts.preview },
    { key: "forecast", label: "Forecast", count: counts.forecast },
    { key: "versions", label: "Versions", count: counts.versions },
  ];
  return <UnderlineTabs label="Rule" tabs={tabs} value={active} onChange={(key) => router.push(key === "rule" ? path : `${path}?tab=${key}`, { scroll: false })} />;
}

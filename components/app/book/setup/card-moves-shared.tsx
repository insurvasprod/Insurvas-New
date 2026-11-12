import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { EVENT_LABELS, type RuleEvent, type RuleMode } from "@/lib/pipelineRules/rules";
import type { BoardPipeline } from "@/lib/pipelineRules/store";

/**
 * Card moves (docs/la4/mockups-r7/carrier-sync-setup.html §2, direction A "By mode", owner 2026-11-10): what the list,
 * a rule's page and its parts share. Server-safe (no "use client"), so a server page can call these.
 */

export const RULES_HREF = "/app/book-setup/pipeline-rules";

/** The list's sub-pages: a rule's mode, and Off for a rule switched off whatever its mode. */
export const RULE_BUCKETS = ["all", "forecast", "live", "off", "draft"] as const;
export type RuleBucket = (typeof RULE_BUCKETS)[number];
export const BUCKET_LABEL: Record<RuleBucket, string> = { all: "All", forecast: "Forecast", live: "Live", off: "Off", draft: "Draft" };

export const bucketOf = (rule: { mode: RuleMode; enabled: boolean }): Exclude<RuleBucket, "all"> => (!rule.enabled ? "off" : rule.mode);
export const isBucket = (value: string | undefined): value is RuleBucket => Boolean(value) && (RULE_BUCKETS as readonly string[]).includes(value!);

/** A rule's page, keeping the list tab it was opened from (its stepper walks that tab). */
export function rulePageHref(id: string, opts: { from?: RuleBucket | null; tab?: string; extra?: Record<string, string> } = {}) {
  const query = new URLSearchParams();
  if (opts.tab && opts.tab !== "overview") query.set("tab", opts.tab);
  if (opts.from) query.set("from", opts.from);
  for (const [key, value] of Object.entries(opts.extra ?? {})) query.set(key, value);
  const text = query.toString();
  return `${RULES_HREF}/${id}${text ? `?${text}` : ""}`;
}

export function stageNames(board: BoardPipeline[]) {
  const map = new Map<string, { stage: string; pipeline: string }>();
  for (const p of board) for (const s of p.stages) map.set(s.id, { stage: s.name, pipeline: p.name });
  return map;
}

/** A stepper button's name: the rule's name, or its event when the name is long (mockup 2·1). */
export function shortRuleName(name: string, event: RuleEvent | null) {
  return name.length > 28 && event ? EVENT_LABELS[event].label : name;
}

/**
 * The stepper on a rule's title line (mockup 2·1): the rules before and after this one in the tab it was opened
 * from, each button naming its rule.
 */
export function RuleStepper({ prev, next }: { prev: { href: string; name: string } | null; next: { href: string; name: string } | null }) {
  if (!prev && !next) return null;
  const cls = buttonVariants({ variant: "outline" });
  return (
    <>
      {prev && <Link href={prev.href} className={`${cls} max-w-[220px]`} title={`Previous rule: ${prev.name}`}><ChevronLeft aria-hidden="true" /><span className="truncate">{prev.name}</span></Link>}
      {next && <Link href={next.href} className={`${cls} max-w-[220px]`} title={`Next rule: ${next.name}`}><span className="truncate">{next.name}</span><ChevronRight aria-hidden="true" /></Link>}
    </>
  );
}

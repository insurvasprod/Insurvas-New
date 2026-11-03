// The pricing page's two pieces of plan arithmetic, pure and client-safe:
//  - planIncrements: what each plan adds over the one before it (the "Everything in X, plus" cards);
//  - recommendPlan: the "Which plan fits you?" picker — the cheapest plan that covers the jobs ticked.
//
// Nothing here names a plan, a price or a feature it was not handed: plans arrive from the catalog,
// and the questions are mapped to catalog modules and feature keys, never to plan codes.

import { featuresByModule, type PublicFeature } from "../publicPlans/types.ts";

export type FitPlan = {
  code: string;
  name: string;
  /** The plan's monthly price in cents; null when it has none (sorted last). */
  monthlyCents: number | null;
  features: PublicFeature[];
};

/** One picker question: a job, mapped to the catalog modules that do it and the features that anchor it. */
export type FitNeed = {
  id: string;
  label: string;
  modules: string[];
  /** The features that make the job possible. Only the ones the catalog sells count; with none, the whole module does. */
  anchors: string[];
};

export const FIT_NEEDS: FitNeed[] = [
  { id: "leads", label: "I buy leads or take live transfers", modules: ["acquisition"], anchors: ["inbound_transfers", "outbound_dialing", "lead_import"] },
  { id: "sell", label: "I need applications and quoting", modules: ["sell"], anchors: ["applications", "quoting"] },
  { id: "partners", label: "I run publishers or partners and pay them out", modules: ["partners"], anchors: ["publisher_records", "payout_runs"] },
  { id: "retention", label: "I want lapse and retention tools", modules: ["retention"], anchors: ["chargeback_radar", "payment_repair", "winback"] },
];

export type ModuleGroup = { module: string; label: string; features: PublicFeature[] };

export type PlanIncrement = {
  code: string;
  /** The plan this one builds on, when it holds every feature of it; null for the first plan or a plan that does not nest. */
  buildsOn: { code: string; name: string } | null;
  /** The modules to list on the card: everything for a base plan, only what is new for one that builds on another. */
  modules: ModuleGroup[];
};

/** Every feature any plan sells, once, keyed by feature key. */
export function catalogFeatures(plans: { features: PublicFeature[] }[]): Map<string, PublicFeature> {
  const all = new Map<string, PublicFeature>();
  for (const plan of plans) for (const feature of plan.features) if (!all.has(feature.key)) all.set(feature.key, feature);
  return all;
}

/**
 * Per plan, in the order given: a plan that holds every feature of the plan before it says
 * "Everything in <previous>, plus" and lists only the difference; any other plan lists all it has.
 */
export function planIncrements(plans: { code: string; name: string; features: PublicFeature[] }[]): PlanIncrement[] {
  return plans.map((plan, index) => {
    const previous = index > 0 ? plans[index - 1] : null;
    const own = new Set(plan.features.map((feature) => feature.key));
    const nests = previous !== null && previous.features.length > 0 && previous.features.every((feature) => own.has(feature.key));
    if (!previous || !nests) return { code: plan.code, buildsOn: null, modules: featuresByModule(plan.features) };
    const before = new Set(previous.features.map((feature) => feature.key));
    return {
      code: plan.code,
      buildsOn: { code: previous.code, name: previous.name },
      modules: featuresByModule(plan.features.filter((feature) => !before.has(feature.key))),
    };
  });
}

/** The feature keys a need requires, given what the catalog sells. Empty when the catalog cannot answer it. */
export function requiredKeys(need: FitNeed, catalog: Map<string, PublicFeature>): string[] {
  const anchors = need.anchors.filter((key) => catalog.has(key));
  if (anchors.length) return anchors;
  return [...catalog.values()].filter((feature) => need.modules.includes(feature.module)).map((feature) => feature.key);
}

/** The questions worth asking: the ones the catalog can answer. */
export function availableNeeds(plans: { features: PublicFeature[] }[], needs: FitNeed[] = FIT_NEEDS): FitNeed[] {
  const catalog = catalogFeatures(plans);
  return needs.filter((need) => requiredKeys(need, catalog).length > 0);
}

export function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export type FitResult =
  | { status: "unanswered" }
  | { status: "none"; reason: string }
  | { status: "match"; code: string; name: string; reason: string };

/**
 * The cheapest plan (by monthly price, then the order given) that holds every feature the ticked
 * jobs require, with one sentence saying why — naming what the next cheaper plan lacks.
 */
export function recommendPlan<P extends FitPlan>(plans: P[], needIds: string[], needs: FitNeed[] = FIT_NEEDS): FitResult {
  const chosen = needs.filter((need) => needIds.includes(need.id));
  if (chosen.length === 0) return { status: "unanswered" };
  const catalog = catalogFeatures(plans);
  const required = chosen.map((need) => ({ need, keys: requiredKeys(need, catalog) })).filter((item) => item.keys.length > 0);
  if (required.length === 0) return { status: "none", reason: "None of our plans covers that yet." };

  const moduleLabelsOf = (keys: string[]) => [...new Set(keys.map((key) => catalog.get(key)?.moduleLabel ?? key))];
  const covers = (plan: P, keys: string[]) => {
    const own = new Set(plan.features.map((feature) => feature.key));
    return keys.every((key) => own.has(key));
  };

  const ranked = plans
    .map((plan, index) => ({ plan, index }))
    .sort((a, b) => (a.plan.monthlyCents ?? Number.POSITIVE_INFINITY) - (b.plan.monthlyCents ?? Number.POSITIVE_INFINITY) || a.index - b.index)
    .map((item) => item.plan);
  const position = ranked.findIndex((plan) => required.every((item) => covers(plan, item.keys)));
  const allLabels = moduleLabelsOf(required.flatMap((item) => item.keys));

  if (position === -1) return { status: "none", reason: `No single plan covers ${joinWords(allLabels)} together yet.` };
  const plan = ranked[position];
  if (position === 0) {
    return { status: "match", code: plan.code, name: plan.name, reason: `${plan.name} already covers ${joinWords(allLabels)}, and it is the lowest-priced plan.` };
  }
  const cheaper = ranked[position - 1];
  const cheaperOwns = new Set(cheaper.features.map((feature) => feature.key));
  const missing = moduleLabelsOf(required.flatMap((item) => item.keys).filter((key) => !cheaperOwns.has(key)));
  return {
    code: plan.code,
    name: plan.name,
    status: "match",
    reason: `${plan.name} is the lowest-priced plan with ${joinWords(allLabels)}; ${cheaper.name} does not include ${joinWords(missing)}.`,
  };
}

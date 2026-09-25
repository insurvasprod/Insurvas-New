/**
 * "It is included from Scale upwards" and "What Scale adds" (p-gate-feature).
 *
 * The first public plan above the current one that grants the feature, and what that plan adds
 * over the current one. Pure, so the ordering rules are tested without the catalogue;
 * lib/plans/upgradePathService.ts reads the public plans and calls this.
 */
export type CataloguePlan = {
  code: string;
  name: string;
  /** Public order, cheapest first. */
  sortOrder: number;
  features: ReadonlySet<string>;
  maxSeats: number | null;
};

export type UpgradePath = {
  plan: { code: string; name: string; maxSeats: number | null };
  /** Features the upgrade grants that the current plan does not, the gated one first. */
  adds: string[];
};

export function upgradePathFor(plans: readonly CataloguePlan[], featureKey: string, currentPlanCode: string | null): UpgradePath | null {
  const ordered = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);
  const currentIndex = currentPlanCode ? ordered.findIndex((plan) => plan.code === currentPlanCode) : -1;
  const current = currentIndex >= 0 ? ordered[currentIndex] : null;
  // Above the current plan only: a cheaper plan that happens to include the feature would lose the
  // customer everything else they have, which is not an upgrade.
  const candidate = ordered.slice(currentIndex + 1).find((plan) => plan.features.has(featureKey));
  if (!candidate) return null;
  const adds = [...candidate.features].filter((key) => !current?.features.has(key));
  adds.sort((a, b) => (a === featureKey ? -1 : b === featureKey ? 1 : 0));
  return { plan: { code: candidate.code, name: candidate.name, maxSeats: candidate.maxSeats }, adds };
}

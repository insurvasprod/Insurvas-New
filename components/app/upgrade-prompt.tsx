import { Lock } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { allMenuItems } from "@/lib/menu/definition";
import { planDisplayName } from "@/lib/plans/display";
import { featureUpgradeOffer } from "@/lib/plans/upgradePathService";

/**
 * Shown instead of a dead end when a feature isn't entitled (SA-2.8), as p-gate-feature draws it.
 *
 * Deliberately says what the feature IS, not just that it's unavailable — someone who doesn't
 * know what they're missing can't decide whether to upgrade. And it says where the feature starts:
 * the first public plan above this one that grants it, and what else that plan adds, read from the
 * same public catalogue /pricing shows. With no such plan, it says only what the account has.
 */
const ADDS_SHOWN = 3;

export async function UpgradePrompt({
  featureLabel,
  featureKey,
  description,
  planCode,
  limitKey,
  usage,
  limit,
  seats,
  grantedFeatures,
}: {
  featureLabel: string;
  /** The feature the page checked; with it, the prompt can name the plan that includes it. */
  featureKey?: string;
  description?: string;
  planCode: string | null;
  limitKey?: string;
  usage?: number;
  limit?: number;
  seats?: number | null;
  /** The account's granted feature keys, so "What you have today" can show the page's neighbours. */
  grantedFeatures?: readonly string[];
}) {
  const offer = featureKey && !limitKey ? await featureUpgradeOffer(featureKey, planCode) : null;
  const currentPlan = planDisplayName(planCode);
  // The page's neighbours in its own menu section, so "what you have" is about this corner of the
  // product rather than the whole plan: "Ledger — Included" beside "Statements — Not included".
  const items = featureKey && grantedFeatures ? allMenuItems() : [];
  const section = items.find((item) => item.required_feature === featureKey)?.sectionId;
  const byFeature = new Map<string, string>();
  for (const item of items) {
    if (item.sectionId === section && item.required_feature && item.required_feature !== featureKey && !byFeature.has(item.required_feature)) {
      byFeature.set(item.required_feature, item.label);
    }
  }
  const neighbours = [...byFeature].slice(0, 2).map(([key, label]) => ({ label, included: Boolean(grantedFeatures?.includes(key)) }));
  const shownAdds = offer ? offer.addsLabels.slice(0, ADDS_SHOWN) : [];
  const moreAdds = offer ? offer.addsLabels.length - shownAdds.length : 0;

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title={featureLabel} />

      <div className="flex min-h-0 flex-grow items-center justify-center">
        <div className="portal-gate-card">
          <div className="portal-gate-lead">
            <span className="portal-gate-icon is-accent">
              <Lock className="size-6" aria-hidden="true" />
            </span>
            <h2>{limitKey ? `${featureLabel} limit reached` : `${featureLabel} is not in your plan`}</h2>
            {description && <p>{description}</p>}
            {limitKey && (
              <p>
                <code>{limitKey}</code>
                {usage != null && limit != null ? ` · ${usage} of ${limit} used` : ""}
              </p>
            )}
            <p>
              {!planCode
                ? "You don't have an active subscription."
                : offer
                  ? `It is included from ${offer.plan.name} upwards. ${currentPlan}, your current plan, does not include it.`
                  : `${currentPlan}, your current plan, does not include it. Talk to your account manager about adding it.`}
            </p>
            <div className="portal-gate-actions">
              <Button asChild>
                <Link href="/pricing">Compare plans</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/app/dashboard">Back to your dashboard</Link>
              </Button>
            </div>
          </div>

          <div className={offer ? "portal-gate-facts is-pair" : "portal-gate-facts"}>
            <section aria-labelledby="gate-today-heading">
              <h2 id="gate-today-heading">What you have today</h2>
              <dl>
                <div><dt>Plan</dt><dd>{currentPlan}</dd></div>
                {seats !== undefined && <div><dt>Seats</dt><dd>{seats ?? "Unlimited"}</dd></div>}
                {neighbours.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.included ? "Included" : "Not included"}</dd></div>)}
                <div><dt>{featureLabel}</dt><dd>{limitKey ? "Limit reached" : "Not included"}</dd></div>
              </dl>
            </section>
            {offer && (
              <section aria-labelledby="gate-adds-heading">
                <h2 id="gate-adds-heading">What {offer.plan.name} adds</h2>
                <dl>
                  {shownAdds.map((label) => <div key={label}><dt>{label}</dt><dd>Included</dd></div>)}
                  {moreAdds > 0 && <div><dt>And more</dt><dd>{moreAdds} other {moreAdds === 1 ? "feature" : "features"}</dd></div>}
                  {offer.plan.maxSeats !== null && offer.plan.maxSeats !== seats && <div><dt>Seats</dt><dd>From {offer.plan.maxSeats}</dd></div>}
                </dl>
              </section>
            )}
          </div>

          <div className="portal-gate-note is-error">
            <strong>An outage is a different screen, deliberately</strong>
            <p>If this feature were switched off for everyone, you would see &ldquo;temporarily unavailable&rdquo; and no price. Offering to sell someone a feature nobody can currently use is the mistake this split exists to prevent.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

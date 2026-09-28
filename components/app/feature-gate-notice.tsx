import { CircleSlash, Wrench } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { UpgradePrompt } from "@/components/app/upgrade-prompt";
import type { PageGuardResult } from "@/lib/entitlements/guardPage";

/**
 * What an agent sees when a page is closed to them, and WHY it is one component (SA-4.10).
 *
 * There are two completely different reasons a feature is unreachable, and showing the wrong one
 * is the mistake this ticket exists to prevent:
 *
 *   not entitled -> "your plan doesn't include this"  -> an upgrade prompt is correct
 *   killed       -> "this is off for everyone"        -> an upgrade prompt is a LIE, and offers to
 *                                                        sell someone something they may already
 *                                                        own and that nobody can use right now
 *   disabled     -> "off for this agency only"       -> an upgrade prompt is also a lie; the plan
 *                                                        includes it and staff switched it off
 *
 * Five pages call this. Putting the branch here rather than in each of them is what stops one page
 * quietly showing an upgrade prompt during an outage.
 */
export function FeatureGateNotice({
  guard,
  featureLabel,
  description,
}: {
  guard: Extract<PageGuardResult, { entitled: false }>;
  featureLabel: string;
  description?: string;
}) {
  if (guard.killed) {
    return (
      <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
        <PageHeader title={featureLabel} />

        <div className="flex min-h-0 flex-grow items-center justify-center">
          <div className="portal-gate-card">
            <div className="portal-gate-lead">
              <span className="portal-gate-icon is-warning">
                <Wrench className="size-6" aria-hidden="true" />
              </span>
              <h2>{featureLabel} is temporarily unavailable</h2>
              {/* The admin's own words when they left a message, and a plain statement when they did
                  not. Never an invented explanation — a made-up reason is worse than none. */}
              <p>{guard.notice ?? "We've switched this off for everyone while we work on it. Nothing you need to do."}</p>
              <p>This is not a change to your plan, and you have not lost anything.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Switched off for this agency alone by Insurvas staff (a per-tenant override). Their plan
  // includes it, so an upgrade prompt would be false — and so would "temporarily unavailable",
  // because it is not a platform-wide outage. Neutral words only; the reason is staff-internal.
  if (guard.disabled) {
    return (
      <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
        <PageHeader title={featureLabel} />

        <div className="flex min-h-0 flex-grow items-center justify-center">
          <div className="portal-gate-card">
            <div className="portal-gate-lead">
              <span className="portal-gate-icon is-info">
                <CircleSlash className="size-6" aria-hidden="true" />
              </span>
              <h2>{featureLabel} is not available on your account</h2>
              <p>Insurvas has switched this off for your agency. It is not a change to your plan, and nothing in it has been deleted.</p>
              <p>If you did not expect this, contact Insurvas support.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <UpgradePrompt
      featureLabel={featureLabel}
      description={description}
      featureKey={guard.feature}
      grantedFeatures={guard.entitlement.features}
      planCode={guard.entitlement.plan_code}
      seats={guard.entitlement.limits.max_seats}
    />
  );
}

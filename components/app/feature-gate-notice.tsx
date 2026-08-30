import { Wrench } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
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
      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-3 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
            <Wrench className="size-5" />
          </div>
          <h2 className="text-lg font-semibold">{featureLabel} is temporarily unavailable</h2>
          <p className="text-sm text-muted-foreground">
            {/* The admin's own words when they left a message, and a plain statement when they did
                not. Never an invented explanation — a made-up reason is worse than none. */}
            {guard.notice ?? "We've switched this off for everyone while we work on it. Nothing you need to do."}
          </p>
          <p className="text-xs text-muted-foreground">
            This is not a change to your plan, and you have not lost anything.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <UpgradePrompt
      featureLabel={featureLabel}
      description={description}
      planCode={guard.entitlement.plan_code}
    />
  );
}

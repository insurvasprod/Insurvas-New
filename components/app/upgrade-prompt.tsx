import { Lock } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { planDisplayName } from "@/lib/plans/display";

/**
 * Shown instead of a dead end when a feature isn't entitled (SA-2.8).
 *
 * Deliberately says what the feature IS, not just that it's unavailable — someone who doesn't
 * know what they're missing can't decide whether to upgrade.
 */
export function UpgradePrompt({
  featureLabel,
  description,
  planCode,
}: {
  featureLabel: string;
  description?: string;
  planCode: string | null;
}) {
  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="space-y-3 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]">
          <Lock className="size-5" />
        </div>
        <h2 className="text-lg font-semibold">{featureLabel} isn&apos;t in your plan</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <p className="text-sm text-muted-foreground">
          {planCode ? (
            <>
              You&apos;re on <span className="font-medium">{planDisplayName(planCode)}</span>. Talk to your account manager about
              adding it.
            </>
          ) : (
            "You don't have an active subscription."
          )}
        </p>
        <Button asChild variant="outline" className="mt-1">
          <Link href="/pricing">View upgrade options</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

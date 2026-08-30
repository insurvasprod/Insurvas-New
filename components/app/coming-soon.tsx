import Link from "next/link";
import { Hammer, ArrowRight } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { MenuItem } from "@/lib/menu/definition";

/**
 * What an agent sees for a feature their plan grants that we have not finished building.
 *
 * This is the third reason a screen can be unreachable, and until now it was the only one with no
 * answer. The other two have had one for a while:
 *
 *   not entitled   "your plan doesn't include this"     -> UpgradePrompt
 *   switched off   "this is off for everyone right now" -> the maintenance notice
 *   not built yet  a 404                                <- twenty-four of thirty menu items
 *
 * A 404 is the worst of the three because it is indistinguishable from a broken product. The
 * customer is paying for this feature, the sidebar promises it, and the link goes nowhere.
 *
 * Two rules for what this says. It never gives a date — we do not have one, and a missed date is
 * worse than no date. And it always offers somewhere to go, because a dead end that apologises is
 * still a dead end.
 */
export function ComingSoon({
  item,
  available,
}: {
  item: MenuItem & { sectionLabel: string };
  /** Screens this agent can actually open right now, for the "meanwhile" links. */
  available: (MenuItem & { sectionLabel: string })[];
}) {
  // Prefer somewhere in the same section — closest to what they were trying to do.
  const nearby = available.filter((i) => i.id !== item.id).slice(0, 3);

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardContent className="space-y-5 py-8">
          <div className="flex size-11 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]">
            <Hammer className="size-5" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {item.sectionLabel}
            </p>
            <h1 className="text-2xl font-extrabold tracking-tight">{item.label} is on the way</h1>
            <p className="max-w-[52ch] text-sm text-muted-foreground">
              {item.blurb ?? "This is part of your plan and we are still building it."}
            </p>
          </div>

          {/* The reassurance that matters: this is not something they have lost or must buy. */}
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Your plan includes this.</span> Nothing to
            buy and nothing to switch on &mdash; it will appear here as soon as it is ready.
          </p>

          {nearby.length > 0 && (
            <div className="space-y-2 border-t border-border pt-5">
              <p className="text-sm font-medium">In the meantime</p>
              <ul className="space-y-1">
                {nearby.map((other) => (
                  <li key={other.id}>
                    <Link
                      href={`/app/${other.id}`}
                      className="group inline-flex items-center gap-1.5 text-sm text-[var(--color-blue)] transition-colors hover:text-[var(--color-blue-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-blue)]"
                    >
                      {other.label}
                      <ArrowRight
                        className="size-3.5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { Card, CardContent } from "@/components/ui/card";
import { LinkArrow } from "@/components/ui/link-arrow";
import { PageHeader } from "@/components/ui/page-header";
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
  // An item may name its own "in the meantime" pages (the board's Statements card does); each is
  // still filtered through `available`, so a page this person cannot open is never offered.
  // Otherwise prefer the same menu section so the links stay relevant to the requested workspace.
  const named = (item.meanwhile ?? [])
    .map((key) => available.find((i) => i.key === key))
    .filter((i): i is MenuItem & { sectionLabel: string } => Boolean(i));
  const nearby = available.filter((i) => i.key !== item.key && i.sectionLabel === item.sectionLabel).slice(0, 3);
  const fallbackNearby = named.length > 0
    ? named.slice(0, 3)
    : nearby.length > 0 ? nearby : available.filter((i) => i.key !== item.key).slice(0, 3);

  return (
    <div className="m-stagger portal-section-page flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader eyebrow={item.sectionLabel} title={item.label} />

      <div className="flex min-h-0 flex-grow items-center justify-center">
        <div className="w-full max-w-[620px]">
          <Card className="portal-section-card py-8">
            <CardContent className="px-8">
              <div className="text-center">
                <span className="portal-section-icon mx-auto inline-flex size-13 items-center justify-center rounded-full bg-[var(--surface-alt)] text-muted-foreground">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                </span>
                <h2 className="mt-4 text-2xl font-semibold leading-[1.21] tracking-[-0.02em]">
                  {item.label} is on the way
                </h2>
                <p className="mt-2.5 text-base leading-[1.5] tracking-[-0.02em] text-muted-foreground">
                  {item.blurb ?? "This is part of your plan and we are still building it."}
                </p>
                {/* The reassurance that matters: this is not something they have lost or must buy. */}
                <p className="mt-2.5 text-base leading-[1.5] tracking-[-0.02em] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Your plan includes this. Nothing to buy and nothing to switch on.
                  </span>{" "}
                  We do not give a date, because a missed date is worse than no date.
                </p>
              </div>

              {fallbackNearby.length > 0 && (
                <div className="mt-7 text-left">
                  <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">In the meantime</h2>
                  <ul>
                    {fallbackNearby.map((other) => (
                      <li
                        key={other.key}
                        className="flex items-center gap-3 border-t border-border py-3"
                      >
                        <span className="min-w-0 flex-grow">
                          <span className="block text-sm font-semibold leading-[1.5] tracking-[-0.02em] text-foreground">
                            {other.label}
                          </span>
                          <span className="block text-xs leading-[1.5] tracking-[-0.01em] text-muted-foreground">
                            {/* A page's own line says why it is worth opening; a same-section page
                                without one says where it lives. */}
                            {other.blurb ?? (other.sectionLabel === item.sectionLabel ? `Also under ${item.sectionLabel}` : other.sectionLabel)}
                          </span>
                        </span>
                        <LinkArrow href={other.path} className="shrink-0">
                          Open
                        </LinkArrow>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

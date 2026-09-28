import { LinkArrow } from "@/components/ui/link-arrow";
import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
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
 * It never gives a date, and it always offers somewhere to go.
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
    <div className="m-stagger portal-section-page flex flex-col gap-6">
      <PageHeader
        title={item.label}
        description={item.blurb ?? "This is part of your plan and we are still building it."}
      />

      <TableCard>
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-muted-foreground">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          <p className="text-sm leading-[1.5] tracking-[-0.02em] text-muted-foreground">
            <span className="font-semibold text-foreground">{item.label} is on the way.</span>{" "}
            Your plan includes this. Nothing to buy and nothing to switch on.
          </p>
        </div>

        {fallbackNearby.length > 0 && (
          <div className="border-t border-border">
            <h2 className="px-4 pt-3 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">In the meantime</h2>
            <ul>
              {fallbackNearby.map((other) => (
                <li key={other.key} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
                  <span className="min-w-0 flex-grow">
                    <span className="block text-sm font-semibold leading-[1.5] tracking-[-0.02em] text-foreground">{other.label}</span>
                    <span className="block text-xs leading-[1.5] tracking-[-0.01em] text-muted-foreground">
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
      </TableCard>
    </div>
  );
}

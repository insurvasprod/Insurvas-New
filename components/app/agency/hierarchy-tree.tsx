import Link from "next/link";

import { cardInset } from "@/components/ui/card";
import { dollars } from "@/lib/agency/constants";
import type { TreeNode } from "@/lib/agency/hierarchyView";
import { cn } from "@/lib/utils";

/**
 * Reports › Hierarchy & overrides, chart view, 6·3 B "Who reports to whom" (owner pick B and C, 2026-11-11): the owner
 * at the top, each producer under the manager he reports to, and on each box the override he brought the agency this
 * month. A negative override is said in the warning tone and signed, as the old red row said it. Every box opens the
 * table view filtered to that producer's rows (`hrefFor`); the owner's box opens every row.
 *
 * Drawn here, not in the chart kit: only this page draws a tree (the board names it a page-local drawing). Lines are
 * hairlines between boxes; a wide team scrolls sideways inside the card, never the page.
 */
export function HierarchyTree({ roots, ownerLabel, ownerCents, ownerHref, hrefFor }: {
  roots: readonly TreeNode[];
  ownerLabel: string;
  ownerCents: number;
  ownerHref: string;
  hrefFor: (node: TreeNode) => string;
}) {
  return (
    <nav aria-label="Who reports to whom" className="-mx-4 overflow-x-auto px-4 pb-1">
      <div className="mx-auto flex w-max min-w-full flex-col items-center pt-2">
        <Box href={ownerHref} name={ownerLabel} cents={ownerCents} caption={`${count(roots)} producer${count(roots) === 1 ? "" : "s"}`} root />
        {roots.length > 0 && <Branches nodes={roots} hrefFor={hrefFor} />}
      </div>
    </nav>
  );
}

function count(nodes: readonly TreeNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + count(node.children), 0);
}

function Branches({ nodes, hrefFor }: { nodes: readonly TreeNode[]; hrefFor: (node: TreeNode) => string }) {
  return (
    <>
      {/* The stem from the box above down to the bar its reports hang from. */}
      <span aria-hidden="true" className="h-5 w-px bg-[var(--border-strong)]" />
      <ul className="m-0 flex list-none justify-center p-0">
        {nodes.map((node) => (
          <li
            key={node.id}
            className={cn(
              "relative flex flex-col items-center px-2 pt-5",
              // Each box's own drop from the bar, and its share of the bar (half of it at either end).
              "before:absolute before:left-1/2 before:top-0 before:h-5 before:w-px before:bg-[var(--border-strong)]",
              "after:absolute after:left-0 after:right-0 after:top-0 after:h-px after:bg-[var(--border-strong)]",
              "first:after:left-1/2 last:after:right-1/2 only:after:hidden",
            )}
          >
            <Box
              href={hrefFor(node)}
              name={node.name}
              cents={node.overrideCents}
              caption={node.levels ? `${node.set} of ${node.levels} levels set` : "No carrier contracts"}
            />
            {node.children.length > 0 && <Branches nodes={node.children} hrefFor={hrefFor} />}
          </li>
        ))}
      </ul>
    </>
  );
}

function Box({ href, name, cents, caption, root = false }: { href: string; name: string; cents: number; caption: string; root?: boolean }) {
  return (
    <Link
      href={href}
      title={`${name}: ${dollars(cents)} override, ${caption}`}
      className={cn(
        cardInset,
        "flex min-w-[9.5rem] max-w-[13rem] flex-col items-center gap-0.5 px-3 py-2 text-center outline-none transition-colors",
        "hover:bg-[var(--surface-alt)] focus-visible:ring-2 focus-visible:ring-ring",
        root && "border-[var(--border-strong)]",
      )}
    >
      <span className="w-full truncate text-sm font-medium text-foreground">{name}</span>
      <span className={cn("text-sm tabular-nums", cents < 0 ? "text-[var(--warning-ink)]" : "text-foreground")}>{dollars(cents)}</span>
      <span className="w-full truncate text-xs text-muted-foreground">{caption}</span>
    </Link>
  );
}

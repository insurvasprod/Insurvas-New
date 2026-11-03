/**
 * Breadcrumb trails (settings-shell plan §2). Pure, so the rules are unit-tested:
 *
 * - Only real pages are links. The last crumb is the current page: never a link.
 * - A trail longer than `max` keeps its root, collapses the middle into one "…" entry (whose hidden
 *   crumbs are kept, for a menu), and keeps the last two.
 * - On a narrow screen only the parent is shown, as "← Parent" (`parentOf`).
 */
export type Crumb = { label: string; href?: string };

export type TrailEntry =
  | { kind: "crumb"; label: string; href?: string; current: boolean }
  | { kind: "more"; hidden: Crumb[] };

export function buildTrail(crumbs: Crumb[], max = 4): TrailEntry[] {
  const items = crumbs.filter((crumb) => crumb.label.trim().length > 0);
  const last = items.length - 1;
  // The current page is plain text, whatever href it was given.
  const entry = (crumb: Crumb, index: number): TrailEntry => ({ kind: "crumb", label: crumb.label, href: index === last ? undefined : crumb.href, current: index === last });
  if (items.length <= max) return items.map(entry);
  return [entry(items[0], 0), { kind: "more", hidden: items.slice(1, -2) }, entry(items[last - 1], last - 1), entry(items[last], last)];
}

/** The page one level up, for the narrow "← Parent" form: the nearest crumb before the last that links somewhere. */
export function parentOf(crumbs: Crumb[]): Crumb | null {
  for (let index = crumbs.length - 2; index >= 0; index -= 1) {
    if (crumbs[index].href) return crumbs[index];
  }
  return null;
}

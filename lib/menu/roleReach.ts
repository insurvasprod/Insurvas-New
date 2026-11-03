/**
 * "What a setter can reach" (p-gate-role): the closed page and the product's main areas, side by
 * side for the viewer's role and for a role that does reach the closed page.
 *
 * Read from the menu's own `required_roles`, the same rules the pages enforce, so the table cannot
 * promise access a page would then refuse. Pure; the role gate passes it the menu.
 */
export type ReachItem = { label: string; path: string; required_roles?: readonly string[] };

export type ReachRow = { area: string; viewer: boolean; other: boolean; current: boolean };

/** The areas every role table shows, in the board's order: dial, book, spend, commission, settings. */
export const REACH_AREAS = ["/app/dialer", "/app/calendar", "/app/campaigns", "/app/ledger", "/app/settings"] as const;

const reaches = (item: ReachItem, role: string) => !item.required_roles || item.required_roles.includes(role);

export function roleReach(items: readonly ReachItem[], viewerRole: string, closedLabel: string): { otherRole: string; rows: ReachRow[] } {
  const closed = items.find((item) => item.label.toLowerCase() === closedLabel.toLowerCase()) ?? null;
  // Compare with someone who does get in: the first non-owner role the closed page admits (the
  // board sets a setter beside a producer), and the owner when only the owner does.
  const otherRole = closed?.required_roles?.find((role) => role !== "owner" && role !== viewerRole) ?? "owner";
  const picked: ReachItem[] = [];
  const add = (item: ReachItem | undefined | null) => { if (item && !picked.some((entry) => entry.path === item.path)) picked.push(item); };
  for (const path of REACH_AREAS) add(items.find((item) => item.path === path));
  if (closed && !picked.some((entry) => entry.path === closed.path)) picked.splice(Math.min(3, picked.length), 0, closed);
  return {
    otherRole,
    rows: picked.map((item) => ({ area: item.label, viewer: reaches(item, viewerRole), other: reaches(item, otherRole), current: item === closed })),
  };
}

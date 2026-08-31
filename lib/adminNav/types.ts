// The admin sidebar's structure, as data.
//
// Icon components are functions with methods and cannot cross the server->client boundary as props,
// so a node carries an icon KEY that the client component resolves. Same reason as before grouping.

export const SIDEBAR_ICONS = [
  "dashboard",
  "tenants",
  "users",
  "activity",
  "features",
  "plans",
  "subscriptions",
  "addons",
  "invoices",
  "coupons",
  "credit-notes",
  "revenue",
  "trials",
  "admins",
  "audit-log",
  "legal",
  "customers",
  "billing",
  "catalog",
  "monitoring",
  "platform",
  "configuration",
] as const;

export type SidebarIconKey = (typeof SIDEBAR_ICONS)[number];

export type SidebarLink = {
  kind: "link";
  href: string;
  label: string;
  icon: SidebarIconKey;
};

export type SidebarGroup = {
  kind: "group";
  /** Stable id for remembering open/closed state across sessions. */
  id: string;
  label: string;
  icon: SidebarIconKey;
  links: SidebarLink[];
};

export type SidebarNode = SidebarLink | SidebarGroup;

export function link(href: string, label: string, icon: SidebarIconKey): SidebarLink {
  return { kind: "link", href, label, icon };
}

/**
 * Builds a group, collapsing it away when it would be pointless.
 *
 * Nothing visible -> no group at all. Exactly one visible child -> that child as a plain top-level
 * link, because a platform_config admin (who can reach four screens in total) should see four links
 * rather than four one-item accordions.
 */
export function group(
  id: string,
  label: string,
  icon: SidebarIconKey,
  links: (SidebarLink | null)[],
): SidebarNode[] {
  const visible = links.filter((entry): entry is SidebarLink => entry !== null);

  if (visible.length === 0) return [];
  if (visible.length === 1) return [visible[0]];
  return [{ kind: "group", id, label, icon, links: visible }];
}

/** Which group, if any, owns the current path — used to keep the active section open. */
export function groupIdForPath(nodes: SidebarNode[], pathname: string): string | null {
  for (const node of nodes) {
    if (node.kind !== "group") continue;
    if (node.links.some((entry) => isLinkActive(entry.href, pathname))) return node.id;
  }
  return null;
}

/**
 * Whether a link is the current page.
 *
 * `/admin` is matched exactly — every other route starts with it, so a prefix match would light up
 * Dashboard on every single screen.
 */
export function isLinkActive(href: string, pathname: string): boolean {
  return href === "/admin" ? pathname === href : pathname.startsWith(href);
}

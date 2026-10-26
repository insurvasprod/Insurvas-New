// The agent sidebar's arrangement, as data (UX-3). `lib/menu/definition.ts` says WHAT the
// destinations are, who may open them and which job group each belongs to (its `section`); this file
// says HOW the rail shows them: Home, then one heading per job group in order, then Settings.
// `components/app/agent-sidebar.tsx` renders `buildSidebarTree()` and decides nothing.
//
// 2026-10-13 (One-Path Plan Phase 2, owner decision "regroup by job"): the rail no longer splits the
// work by module (LA-1 Inbound, LA-2 Outbound, LA-3 Applications, Business). A person looks for what
// they are doing — today's calls, leads, the sale, the book, the money — not which module built it.
// Screens that do not exist yet ("on the way") stay in the menu definition, so a plan that grants one
// still reaches its coming-soon page, but they leave the rail until they are built (LA-0.3: no
// placeholders). A new section appears after the listed groups by data alone. Client-safe and pure.
import type { MenuItem, MenuSection } from "./definition";

/** The server's word on which acquisition modules the tenant bought (the effective entitlement). */
export type ModuleAccess = { inbound: boolean; outbound: boolean };

/** The rail's job groups, in order, by menu section label. Unlisted sections follow, briefcased. */
// 2026-10-15 (owner decision): eleven short groups instead of eight long ones — no dropdown past eight.
export const NAV_GROUPS: readonly { section: string; icon: string }[] = [
  { section: "Today", icon: "calendar-check" },
  // Agency Module 0: only an agency plan has anything in it.
  { section: "Team", icon: "users" },
  { section: "Leads", icon: "contact-round" },
  { section: "Sales", icon: "file-check" },
  { section: "Book", icon: "book-open" },
  { section: "Commissions", icon: "receipt" },
  { section: "Data in", icon: "folder-input" },
  { section: "Accounting", icon: "landmark" },
  // Its own icon (2026-10-25): on the icon rail two groups cannot share one.
  { section: "Partners", icon: "handshake" },
  { section: "Compliance", icon: "shield-check" },
  { section: "Reports", icon: "chart-column" },
];

/** Sections shown as single links rather than groups. */
export const NAV_STANDALONE = { home: "Home", settings: "Settings" } as const;
const FALLBACK_GROUP_ICON = "briefcase-business";

export type SidebarGroup = { label: string; icon: string; items: MenuItem[] };

export type SidebarTree = {
  home: MenuItem[];
  groups: SidebarGroup[];
  settings: MenuItem[];
};

/** The rail for this person: the server-filtered menu, arranged. Nothing here grants anything. */
export function buildSidebarTree(menu: MenuSection[], moduleAccess?: ModuleAccess): SidebarTree {
  void moduleAccess; // Kept in the signature: the shell still passes it, and module headings may return.
  // `sidebar: false` — a settings page (Accounting settings, Carrier rules): reached from Settings.
  const shown = menu.flatMap((section) => section.items).filter((item) => item.built && item.sidebar !== false);
  // A merged page's stand-in (2026-10-26) shows only when the page's own item does not.
  const keys = new Set(shown.map((item) => item.key));
  const all = shown.filter((item) => !item.sidebar_fallback_for || !keys.has(item.sidebar_fallback_for));
  const standalone = new Set<string>(Object.values(NAV_STANDALONE));
  const grouped = all.filter((item) => !standalone.has(item.section));
  const listed = NAV_GROUPS.map((group) => group.section);
  const sections = [...listed, ...[...new Set(grouped.map((item) => item.section))].filter((section) => !listed.includes(section))];
  return {
    home: all.filter((item) => item.section === NAV_STANDALONE.home),
    groups: sections
      .map((section) => ({
        label: section,
        icon: NAV_GROUPS.find((group) => group.section === section)?.icon ?? FALLBACK_GROUP_ICON,
        items: grouped.filter((item) => item.section === section),
      }))
      .filter((group) => group.items.length > 0),
    settings: all.filter((item) => item.section === NAV_STANDALONE.settings),
  };
}

/** The groups open on arrival: the one holding the page, else the first group with something in it. */
export function initialOpenGroups(tree: SidebarTree, isActive: (item: MenuItem) => boolean): string[] {
  const active = tree.groups.filter((group) => group.items.some(isActive)).map((group) => group.label);
  if (active.length) return active;
  return tree.groups[0] ? [tree.groups[0].label] : [];
}

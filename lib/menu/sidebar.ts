// The agent sidebar's arrangement, as data (UX-3). `lib/menu/definition.ts` says WHAT the
// destinations are and who may open them; this file says HOW the rail groups them: the module
// headings (LA-1 Inbound, LA-2 Outbound, LA-3 Applications, …), their order, the Business groups and
// Partners. `components/app/agent-sidebar.tsx` renders `buildSidebarTree()` and decides nothing.
//
// Adding a module heading is one entry in NAV_MODULES; a new menu section appears under Business by
// itself (after the listed ones) until it is given a place here. Client-safe and pure.
import type { MenuItem, MenuSection } from "./definition";

/** The server's word on which acquisition modules the tenant bought (the effective entitlement). */
export type ModuleAccess = { inbound: boolean; outbound: boolean };

export type NavModuleDefinition = {
  id: string;
  /** Short enough to sit beside "Enabled" in capitals without an ellipsis. */
  label: string;
  /** On the heading's tooltip and accessible name. */
  fullName: string;
  /** An icon name the sidebar's ICONS map resolves. */
  icon: string;
  /** Items join the module by the feature that gates them. */
  features: readonly string[];
  /** Items join by key, whatever gates them (LA-3: `quoting` also gates steps inside a case). */
  keys?: readonly string[];
  /**
   * Destinations shared by more than one workflow. They join this module only while it is bought;
   * otherwise they stay in Business, so a Book-of-Business-only tenant does not lose a route.
   */
  shared?: readonly string[];
  /** Item order inside the heading; anything unlisted follows. */
  order: readonly string[];
  /** The ModuleAccess flag that says it is bought. Unset: bought when it has any item to show. */
  access?: keyof ModuleAccess;
  /** Unbought modules show a locked heading ("Not included") unless this is set. */
  hideWhenEmpty?: boolean;
  /** Opened on arrival when no module holds the current page (the first such module with items). */
  defaultOpen?: boolean;
};

export const NAV_MODULES: readonly NavModuleDefinition[] = [
  {
    id: "la1",
    label: "Inbound",
    fullName: "LA-1 Inbound operations",
    icon: "phone-incoming",
    features: ["inbound_transfers"],
    shared: ["leads.workspace", "sell.callbacks"],
    order: ["leads.floor", "leads.inbound", "leads.workspace", "sell.callbacks", "leads.partner-chat"],
    access: "inbound",
    defaultOpen: true,
  },
  {
    id: "la2",
    label: "Outbound",
    fullName: "LA-2 Outbound acquisition",
    icon: "phone-outgoing",
    features: ["outbound_dialing", "lead_import", "true_cpa"],
    shared: ["sell.deal-flow"],
    order: ["leads.dialer", "leads.import", "leads.lists", "leads.nurture", "leads.assignments", "sell.calendar", "sell.deal-flow", "insight.true-cpa", "insight.vendor-returns", "insight.activity"],
    access: "outbound",
    defaultOpen: true,
  },
  {
    // LA-3 follows the two acquisition modules it takes the sale from, above Business.
    id: "la3",
    label: "Applications",
    fullName: "LA-3 Application flow",
    icon: "file-check",
    features: [],
    keys: ["sell.applications", "sell.quoting", "sell.pending", "sell.draft-dates", "insight.sales-performance"],
    order: ["sell.applications", "sell.quoting", "sell.pending", "sell.draft-dates", "insight.sales-performance"],
    hideWhenEmpty: true,
  },
];

/** The Business disclosure's groups, in order, by menu section. Unlisted sections follow, briefcased. */
export const NAV_BUSINESS_GROUPS: readonly { section: string; icon: string }[] = [
  { section: "Book of Business", icon: "book-open" },
  { section: "Leads", icon: "contact-round" },
  { section: "Sell", icon: "calculator" },
  { section: "Retention", icon: "rotate-ccw" },
  { section: "Insight", icon: "chart-no-axes-combined" },
  { section: "Accounting", icon: "landmark" },
  { section: "Compliance", icon: "shield-check" },
];

/** Sections with a heading of their own beside Business rather than inside it. */
export const NAV_STANDALONE = { home: "Home", partners: "Partners", settings: "Settings" } as const;
export const NAV_BUSINESS_ICON = "briefcase-business";
export const NAV_PARTNERS_ICON = "users";
const FALLBACK_GROUP_ICON = "briefcase-business";

export type SidebarModule = {
  id: string;
  label: string;
  fullName: string;
  icon: string;
  items: MenuItem[];
  entitled: boolean;
  /** "Enabled", "Not included" or "Role restricted". */
  status: string;
  disabled: boolean;
  defaultOpen: boolean;
};

export type SidebarTree = {
  home: MenuItem[];
  modules: SidebarModule[];
  business: { label: string; icon: string; items: MenuItem[] }[];
  partners: MenuItem[];
  settings: MenuItem[];
};

function ordered(items: MenuItem[], order: readonly string[]) {
  const at = (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
  return [...items].sort((a, b) => at(a.key) - at(b.key));
}

/** The rail for this person: the server-filtered menu, arranged. Nothing here grants anything. */
export function buildSidebarTree(menu: MenuSection[], moduleAccess?: ModuleAccess): SidebarTree {
  const all = menu.flatMap((section) => section.items);
  const modules = NAV_MODULES.map((definition): SidebarModule => {
    const byFeature = (item: MenuItem) => Boolean(item.required_feature && definition.features.includes(item.required_feature));
    const bought = definition.access
      ? moduleAccess?.[definition.access] ?? all.some(byFeature)
      : undefined;
    const items = ordered(
      all.filter((item) => byFeature(item) || definition.keys?.includes(item.key) || (bought && definition.shared?.includes(item.key))),
      definition.order,
    );
    const entitled = bought ?? items.length > 0;
    const visible = items.length > 0;
    return {
      id: definition.id,
      label: definition.label,
      fullName: definition.fullName,
      icon: definition.icon,
      items,
      entitled,
      status: !entitled ? "Not included" : visible ? "Enabled" : "Role restricted",
      disabled: !entitled || !visible,
      defaultOpen: Boolean(definition.defaultOpen),
    };
  }).filter((module, index) => !(NAV_MODULES[index].hideWhenEmpty && module.items.length === 0));

  const inModule = new Set(modules.flatMap((module) => module.items.map((item) => item.key)));
  const partners = all.filter((item) => item.section === NAV_STANDALONE.partners);
  const standalone = new Set<string>(Object.values(NAV_STANDALONE));
  const businessItems = all.filter((item) => !standalone.has(item.section) && !inModule.has(item.key));
  const listed = NAV_BUSINESS_GROUPS.map((group) => group.section);
  const sections = [...listed, ...[...new Set(businessItems.map((item) => item.section))].filter((section) => !listed.includes(section))];
  const business = sections
    .map((section) => ({
      label: section,
      icon: NAV_BUSINESS_GROUPS.find((group) => group.section === section)?.icon ?? FALLBACK_GROUP_ICON,
      items: businessItems.filter((item) => item.section === section),
    }))
    .filter((group) => group.items.length > 0);

  return {
    home: all.filter((item) => item.section === NAV_STANDALONE.home),
    modules,
    business,
    partners,
    settings: all.filter((item) => item.section === NAV_STANDALONE.settings),
  };
}

/** The module that holds the page, else the first default-open module with something to show. */
export function initialOpenModule(tree: SidebarTree, isActive: (item: MenuItem) => boolean): string | null {
  return (
    tree.modules.find((module) => module.items.some(isActive))?.id ??
    tree.modules.find((module) => module.defaultOpen && module.items.length > 0)?.id ??
    null
  );
}

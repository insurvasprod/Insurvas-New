"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Building2,
  ChevronDown,
  ClipboardList,
  CreditCard,
  Hourglass,
  LayoutDashboard,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Receipt,
  Repeat,
  Scale,
  ScrollText,
  Settings,
  SlidersHorizontal,
  CreditCard as CardIcon,
  BadgePercent,
  Boxes,
  LayoutTemplate,
  ShieldCheck as ShieldIcon,
  Gauge,
  Mail,
  Menu,
  ServerCog,
  Tag,
  ToggleRight,
  TrendingUp,
  Undo2,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { usePersistedState } from "./use-persisted-state";
import { groupIdForPath, isLinkActive, type SidebarIconKey, type SidebarNode } from "@/lib/adminNav/types";

// Icon components are functions with methods and cannot cross the server->client boundary as props,
// so the server sends a key and it is resolved here.
const ICONS: Record<SidebarIconKey, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  tenants: Building2,
  users: UserRound,
  activity: Activity,
  features: ToggleRight,
  plans: Package,
  subscriptions: Repeat,
  addons: Puzzle,
  invoices: Receipt,
  coupons: Tag,
  "credit-notes": Undo2,
  revenue: TrendingUp,
  trials: Hourglass,
  admins: Users,
  "audit-log": ScrollText,
  legal: Scale,
  customers: Building2,
  billing: CreditCard,
  catalog: Package,
  monitoring: ClipboardList,
  platform: Settings,
  payments: CardIcon,
  offers: BadgePercent,
  products: Boxes,
  carriers: Building2,
  templates: LayoutTemplate,
  compliance: ShieldIcon,
  limits: Gauge,
  email: Mail,
  system: ServerCog,
  advanced: SlidersHorizontal,
};

const COLLAPSED_KEY = "insurvas.admin.sidebar.collapsed";
const OPEN_GROUPS_KEY = "insurvas.admin.sidebar.openGroups";
// Every group starts shut, as p-adm-home draws them; the one holding the current page opens itself
// (see `isOpen` below).
const DEFAULT_OPEN_GROUPS: string[] = [];

const ACTIVE_STYLE = {
  background: "var(--soft-orange-surface)",
  boxShadow: "inset 2px 0 0 var(--primary)",
} as const;

type Props = { nodes: SidebarNode[]; adminName: string; roleLabel: string };

/**
 * The staff rail. The same rail as the agent's (p-adm-home draws them one-for-one): 264px, 33px
 * items at 14px, 30px uppercase headings led by their arrow, one orange chip for the page you are
 * on, and a card at the foot. It stays on the product's one palette — the board's navy and blue are
 * the palette the design system replaced, not a staff identity.
 */
export function AdminSidebar({ nodes, adminName, roleLabel }: Props) {
  const pathname = usePathname();
  const activeGroupId = useMemo(() => groupIdForPath(nodes, pathname), [nodes, pathname]);

  const [collapsed, setCollapsed] = usePersistedState<boolean>(COLLAPSED_KEY, false);
  const [openGroups, setOpenGroups] = usePersistedState<string[]>(OPEN_GROUPS_KEY, DEFAULT_OPEN_GROUPS);
  const [flyout, setFlyout] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleGroup(id: string) {
    setOpenGroups(openGroups.includes(id) ? openGroups.filter((entry) => entry !== id) : [...openGroups, id]);
  }

  function toggleCollapsed() {
    setCollapsed(!collapsed);
    setFlyout(null);
  }

  /**
   * The section you are currently inside is always open, whatever was remembered.
   *
   * Deliberately not "opened once, then closeable": collapsing the group that holds the page you
   * are looking at hides your own location in the tree, and a deep link would otherwise land you
   * in a section that appears shut. Every other group is yours to open and close.
   */
  const isOpen = (id: string) => openGroups.includes(id) || id === activeGroupId;

  function renderLink(entry: Extract<SidebarNode, { kind: "link" }>, rail: boolean, onNavigate?: () => void) {
    const Icon = ICONS[entry.icon];
    const active = isLinkActive(entry.href, pathname);

    return (
      <Link
        key={entry.href}
        href={entry.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        title={rail ? entry.label : undefined}
        // 8px radius, 14px label, 33px tall — the artboard's rail item. The active one is the
        // only orange object on the column: a soft-orange chip with a 2px bar cut into its left
        // edge, so "where am I" is answered by a shape rather than by a slightly bolder grey.
        className={`flex h-[33px] shrink-0 items-center gap-2 rounded-lg text-sm leading-normal tracking-[-0.02em] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] ${
          // Children sit flush with the headings, as the board draws them — no extra indent.
          rail ? "justify-center px-0" : "px-2.5"
        }`}
        style={{
          background: active ? ACTIVE_STYLE.background : "transparent",
          boxShadow: active ? ACTIVE_STYLE.boxShadow : "none",
          fontWeight: 500,
          // Links are drawn in --nav-ink; only the section headings are muted.
          color: active ? "var(--accent-ink)" : "var(--nav-ink)",
        }}
        onMouseEnter={(event) => {
          if (active) return;
          event.currentTarget.style.background = "rgba(255,255,255,.06)";
          event.currentTarget.style.color = "var(--nav-ink)";
        }}
        onMouseLeave={(event) => {
          if (active) return;
          event.currentTarget.style.background = "transparent";
          event.currentTarget.style.color = "var(--nav-ink)";
        }}
      >
        {/* Every row keeps its icon, child rows included (design contract D-05). */}
        <Icon size={17} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />        {!rail && <span className="truncate">{entry.label}</span>}
      </Link>
    );
  }

  /** One tree for both the desktop rail and the phone drawer, so the two can no longer drift. */
  function renderNav(rail: boolean, onNavigate?: () => void) {
    return nodes.map((node) => {
      if (node.kind === "link") return renderLink(node, rail, onNavigate);

      const Icon = ICONS[node.icon];
      const open = isOpen(node.id);
      const containsActive = node.id === activeGroupId;

      return (
        <div
          key={node.id}
          className="relative"
          onMouseEnter={() => rail && setFlyout(node.id)}
          onMouseLeave={() => rail && setFlyout(null)}
        >
          <button
            type="button"
            onClick={() => (rail ? toggleCollapsed() : toggleGroup(node.id))}
            title={rail ? node.label : undefined}
            aria-expanded={rail ? undefined : open}
            // The board's heading margin is 8px above, 2px below, and its margins collapse; flex gaps
            // do not, so the nav's 2px gap plus 6px here makes the same 8px, and the children's own
            // 2px top margin makes the 2px below.
            className={`portal-admin-rail-group flex w-full items-center gap-2 rounded-lg text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] ${
              rail ? "h-[33px] justify-center px-0" : "mt-1.5 h-[30px] px-2.5"
            }`}
            style={{
              // In the collapsed rail there are no child links to show the active state, so the
              // group itself carries it — otherwise the whole sidebar looks unselected.
              background: rail && containsActive ? ACTIVE_STYLE.background : undefined,
            }}
          >
            {rail ? (
              // The collapsed rail is nothing but icons; a heading has no room for its words there.
              <Icon size={15} strokeWidth={1.8} className="shrink-0" />
            ) : (
              <>
                {/* The arrow leads the heading: right when shut, down when open. */}
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
                />
                <span className="truncate">{node.label}</span>
              </>
            )}
          </button>

          {!rail && open && (
            <div className="mt-0.5 flex flex-col gap-0.5">
              {node.links.map((entry) => renderLink(entry, false, onNavigate))}
            </div>
          )}

          {rail && flyout === node.id && (
            <div
              className="absolute left-full top-0 z-50 ml-2 w-56 rounded-xl border border-border p-2 text-foreground shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
              style={{ background: "var(--surface)" }}
            >
              <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">
                {node.label}
              </p>
              {node.links.map((entry) => {
                const active = isLinkActive(entry.href, pathname);
                return (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    aria-current={active ? "page" : undefined}
                    className="block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-muted"
                    style={{
                      fontWeight: 500,
                      background: active ? "var(--soft-orange-surface)" : "transparent",
                      color: active ? "var(--accent-ink)" : undefined,
                    }}
                  >
                    {entry.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  }

  const brand = (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-xs font-semibold text-[var(--on-primary)]"
      >
        I
      </span>
      <span className="text-sm font-semibold tracking-[-0.01em]">Insurvas staff</span>
    </div>
  );

  // The agent rail's plan card, holding what is true for staff: who is signed in and in what role.
  // No sign-out here — it is the labelled last row of the top bar's account menu.
  const staffCard = (
    <section className="portal-agent-plan-card" aria-label="Signed in as">
      <p className="portal-agent-plan-card-label">Staff</p>
      <p className="portal-agent-plan-card-name truncate">{adminName}</p>
      <p className="portal-agent-plan-card-role">{roleLabel}</p>
    </section>
  );

  return (
    <>
      <header
        data-print-hide
        className="portal-agent-sidebar-mobile sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card px-4 py-3 text-foreground md:hidden"
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open admin menu"
          aria-expanded={mobileOpen}
          className="-ml-1 rounded-md p-1.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        {brand}
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close admin menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          {/* The same rail, not a white sheet with its own 15px rows: a phone gets the product. */}
          <aside
            data-print-hide
            className="portal-agent-sidebar-mobile-drawer absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto"
          >
            <div className="portal-agent-sidebar-brand flex items-center justify-between">
              {brand}
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close admin menu"
                className="portal-agent-sidebar-collapse rounded-md p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-0.5 p-2.5" aria-label="Admin navigation">
              {renderNav(false, () => setMobileOpen(false))}
            </nav>
            {staffCard}
          </aside>
        </div>
      )}

      <aside
        data-print-hide
        // No right border: the board's rail ends in its own dark edge.
        className={`relative hidden shrink-0 flex-col transition-[width] duration-200 md:flex ${
          collapsed ? "w-[76px]" : "w-[264px]"
        }`}
        style={{
          background: "var(--nav-bg)",
          color: "var(--nav-ink)",
        }}
      >
        <div
          className={`flex items-center ${collapsed ? "justify-center py-4" : "px-[18px] py-4"}`}
          style={{ borderBottom: "1px solid var(--nav-line)" }}
        >
          {collapsed ? (
            <span
              aria-label="Insurvas staff"
              className="inline-flex size-[26px] items-center justify-center rounded-lg bg-[var(--primary)] text-xs font-semibold text-[var(--on-primary)]"
            >
              I
            </span>
          ) : (
            brand
          )}
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2.5" aria-label="Admin navigation">
          {renderNav(collapsed)}
        </nav>

        {!collapsed && staffCard}

        <div className="portal-admin-rail-footer p-2.5" style={{ borderTop: "1px solid var(--nav-line)" }}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`portal-admin-rail-collapse flex h-[33px] w-full items-center gap-2 rounded-lg px-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] ${
              collapsed ? "justify-center px-0" : ""
            }`}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

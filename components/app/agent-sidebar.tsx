"use client";

import { createElement, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Calculator,
  CalendarCheck,
  UserRoundCheck,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  Circle,
  ClipboardList,
  ContactRound,
  CopyCheck,
  ExternalLink,
  FileChartColumn,
  FileCheck,
  FileText,
  FolderInput,
  Landmark,
  LayoutDashboard,
  ListChecks,
  ListPlus,
  LockKeyhole,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  Package,
  PhoneIncoming,
  PhoneOutgoing,
  Radar,
  RadioTower,
  Receipt,
  RotateCcw,
  Route,
  Settings,
  ShieldCheck,
  Store,
  TriangleAlert,
  TrendingUp,
  Users,
  WalletCards,
  Wrench,
  Activity,
  BadgeCheck,
  BadgeDollarSign,
  BookUser,
  ChartColumn,
  ChartLine,
  CircleAlert,
  FilePenLine,
  Files,
  Gauge,
  Gavel,
  HandCoins,
  Handshake,
  Headset,
  HeartHandshake,
  Hourglass,
  Import,
  Inbox,
  LifeBuoy,
  Link2,
  PhoneCall,
  PhoneOff,
  Recycle,
  Scale,
  ScrollText,
  SquareKanban,
  Undo2,
  X,
} from "lucide-react";

import type { MenuItem, MenuSection } from "@/lib/menu/definition";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { buildSidebarTree, initialOpenGroups, type ModuleAccess } from "@/lib/menu/sidebar";

/** Which acquisition modules the effective tenant entitlement includes (inbound, outbound). */
export type AgentModuleAccess = ModuleAccess;

function iconFor(name: string) {
  return ICONS[name as keyof typeof ICONS] ?? Circle;
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItemLink({
  item,
  onNavigate,
  nested = false,
}: {
  item: MenuItem;
  onNavigate?: () => void;
  nested?: boolean;
}) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.path);
  const Icon = iconFor(item.icon);
  const label = item.navLabel ?? item.label;

  return (
    <li>
      <Link
        href={item.path}
        onClick={onNavigate}
        aria-label={label}
        title={label}
        aria-current={active ? "page" : undefined}
        className={`portal-agent-nav-link ${nested ? "portal-agent-nav-link-nested" : ""} ${active ? "is-active" : ""}`}
      >
        <span className="portal-agent-nav-link-copy">
          {createElement(Icon, {
            className: "portal-agent-nav-icon",
            "aria-hidden": true,
          })}
          <span className="portal-agent-nav-label">{label}</span>
        </span>
        {!item.built && (
          <span
            className="portal-agent-nav-waypoint"
            title="On the way"
            aria-label="On the way"
          />
        )}
      </Link>
    </li>
  );
}

function DisclosureSection({
  label,
  icon: Icon,
  items,
  children,
  open,
  onToggle,
  onNavigate,
  active,
  nested = false,
}: {
  label: string;
  icon: typeof BriefcaseBusiness;
  items: MenuItem[];
  children?: ReactNode;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  active: boolean;
  nested?: boolean;
}) {
  if (items.length === 0 && !children) return null;

  const sectionId = `agent-nav-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <section
      className={`portal-agent-nav-section ${nested ? "portal-agent-nav-business-group" : ""} ${active ? "is-active" : ""}`}
    >
      <button
        type="button"
        className="portal-agent-nav-disclosure"
        aria-label={label}
        aria-expanded={open}
        aria-controls={sectionId}
        onClick={onToggle}
      >
        <span className="portal-agent-nav-disclosure-copy">
          <Icon className="portal-agent-nav-icon" aria-hidden="true" />
          <span>{label}</span>
        </span>
        <ChevronDown
          className={`portal-agent-nav-chevron ${open ? "is-open" : ""}`}
          aria-hidden="true"
        />
      </button>
      {children ? (
        <div id={sectionId} className="portal-agent-nav-disclosure-content" hidden={!open}>
          {children}
        </div>
      ) : (
        <ul id={sectionId} hidden={!open} className={`portal-agent-nav-sublist ${nested ? "portal-agent-nav-sublist-nested" : ""}`}>
          {items.map((item) => (
            <NavItemLink
              key={item.key}
              item={item}
              nested
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export type AgentPlanSummary = {
  /** Display name of the plan, or null when the workspace has none. */
  name: string | null;
  /** The plan's seat limit. Null means unlimited, and then no number is shown. */
  seats: number | null;
  roleLabel: string;
  isOwner: boolean;
};

/**
 * The rail's last block, as the board draws it: what plan this is, how big, and what you may do in
 * it. It used to repeat "Inbound enabled / Outbound enabled", which the LA-1 and LA-2 headings
 * directly above already say.
 */
function PlanCard({ plan }: { plan: AgentPlanSummary }) {
  const size = [plan.name ?? "No plan", plan.seats === null ? null : `${plan.seats} ${plan.seats === 1 ? "seat" : "seats"}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="portal-agent-plan-card" aria-label="Plan">
      <p className="portal-agent-plan-card-label">Plan</p>
      <p className="portal-agent-plan-card-name">{size}</p>
      <p className="portal-agent-plan-card-role">
        {plan.roleLabel} · {plan.isOwner ? "full access" : "role-based access"}
      </p>
    </section>
  );
}

/**
 * Entitlement-aware navigation for the licensed-agent shell.
 *
 * The server still supplies the filtered menu and every route keeps its own guard. The arrangement
 * — Home, the job groups in order, Settings — is data in `lib/menu/sidebar.ts` (UX-3; regrouped by
 * job 2026-10-13); this component renders `buildSidebarTree()` and only owns what is open.
 */
function NavList({
  menu,
  moduleAccess,
  onNavigate,
  isCollapsed = false,
  onExpand,
}: {
  menu: MenuSection[];
  moduleAccess?: AgentModuleAccess;
  onNavigate?: () => void;
  isCollapsed?: boolean;
  onExpand?: (groupLabel: string) => void;
}) {
  const pathname = usePathname();
  const tree = buildSidebarTree(menu, moduleAccess);
  const isActive = (item: MenuItem) => isActivePath(pathname, item.path);
  const activeGroupLabel = tree.groups.find((group) => group.items.some(isActive))?.label;
  const [navState, setNavState] = useState<{ pathname: string; openGroup: string | null }>(() => ({
    pathname,
    openGroup: initialOpenGroups(tree, isActive)[0] ?? null,
  }));
  let openGroup = navState.openGroup;
  if (navState.pathname !== pathname) {
    openGroup = activeGroupLabel ?? navState.openGroup;
    setNavState({ pathname, openGroup });
  }

  return (
    <nav className="portal-agent-nav" aria-label="Agent workspace navigation">
      <ul className="portal-agent-nav-home">
        {tree.home.map((item) => (
          <NavItemLink key={item.key} item={item} onNavigate={onNavigate} />
        ))}
      </ul>

      {tree.groups.map((group) => (
        <DisclosureSection
          key={group.label}
          label={group.label}
          icon={iconFor(group.icon)}
          items={group.items}
          open={openGroup === group.label}
          active={group.items.some(isActive)}
          onToggle={() => {
            if (isCollapsed) {
              onExpand?.(group.label);
              setNavState({ pathname, openGroup: group.label });
              return;
            }
            setNavState({
              pathname,
              openGroup: openGroup === group.label ? null : group.label,
            });
          }}
          onNavigate={onNavigate}
        />
      ))}

      {tree.settings.map((item) => (
        <ul key={item.key} className="portal-agent-nav-settings">
          <NavItemLink item={item} onNavigate={onNavigate} />
        </ul>
      ))}
    </nav>
  );
}

const ICONS = {
  "layout-dashboard": LayoutDashboard,
  "book-open": BookOpen,
  "file-text": FileText,
  "folder-input": FolderInput,
  receipt: Receipt,
  "calendar-days": CalendarDays,
  "triangle-alert": TriangleAlert,
  "contact-round": ContactRound,
  "phone-incoming": PhoneIncoming,
  "phone-outgoing": PhoneOutgoing,
  "list-plus": ListPlus,
  "copy-check": CopyCheck,
  calculator: Calculator,
  "file-check": FileCheck,
  "calendar-clock": CalendarClock,
  "calendar-check": CalendarCheck,
  "user-round-check": UserRoundCheck,
  "clipboard-list": ClipboardList,
  radar: Radar,
  "radio-tower": RadioTower,
  wrench: Wrench,
  "rotate-ccw": RotateCcw,
  "chart-no-axes-combined": ChartNoAxesCombined,
  "trending-up": TrendingUp,
  users: Users,
  "wallet-cards": WalletCards,
  "external-link": ExternalLink,
  landmark: Landmark,
  "file-chart-column": FileChartColumn,
  "shield-check": ShieldCheck,
  "lock-keyhole": LockKeyhole,
  "briefcase-business": BriefcaseBusiness,
  settings: Settings,
  "messages-square": MessageSquare,
  route: Route,
  "list-checks": ListChecks,
  package: Package,
  // Both LA-2 destinations. `iconFor()` falls back to a featureless Circle for an unknown name, so
  // a missing entry here is invisible in review and looks deliberate on screen.
  // `lib/design/contract.test.mjs` now fails when the menu names an icon this map lacks.
  store: Store,
  brain: Brain,
  // One icon per page (2026-10-06): no two destinations, and no page and its own heading, share one.
  "activity": Activity,
  "badge-check": BadgeCheck,
  "badge-dollar-sign": BadgeDollarSign,
  "book-user": BookUser,
  "chart-column": ChartColumn,
  "chart-line": ChartLine,
  "circle-alert": CircleAlert,
  "file-pen-line": FilePenLine,
  "files": Files,
  "gauge": Gauge,
  "gavel": Gavel,
  "hand-coins": HandCoins,
  "handshake": Handshake,
  "headset": Headset,
  "heart-handshake": HeartHandshake,
  "hourglass": Hourglass,
  "import": Import,
  "inbox": Inbox,
  "life-buoy": LifeBuoy,
  link: Link2,
  "phone-call": PhoneCall,
  "phone-off": PhoneOff,
  "recycle": Recycle,
  "scale": Scale,
  "scroll-text": ScrollText,
  "square-kanban": SquareKanban,
  undo: Undo2,
} as const;

export function AgentSidebar({
  menu,
  footer,
  moduleAccess,
  plan,
}: {
  menu: MenuSection[];
  footer?: ReactNode;
  moduleAccess?: AgentModuleAccess;
  plan?: AgentPlanSummary;
}) {
  const [open, setOpen] = useState(false);

  // One mark everywhere the product names itself — the phone bar and drawer used a building icon.
  // The rail and drawer are always ink, so they take the on-dark mark; the white phone bar follows
  // the theme.
  const brandMark = (tone?: "dark") => (
    <div className="flex items-center gap-2.5">
      <InsurvasLogo size="sidebar" tone={tone} />
    </div>
  );

  return (
    <>
      <header
        data-print-hide
        className="portal-agent-sidebar-mobile sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card px-4 py-3 text-foreground md:hidden"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="-ml-1 rounded-md p-1.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        {brandMark()}
      </header>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <div className="portal-agent-sidebar-mobile-drawer absolute inset-y-0 left-0 flex w-80 max-w-[88vw] flex-col overflow-y-auto p-4 text-foreground">
            <div className="min-h-0 flex-1">
              <div className="portal-agent-sidebar-brand">
                {brandMark("dark")}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="portal-agent-sidebar-collapse rounded-md p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <NavList
                menu={menu}
                moduleAccess={moduleAccess}
                onNavigate={() => setOpen(false)}
              />
            </div>
            {plan && <PlanCard plan={plan} />}
            {footer && <div className="portal-agent-sidebar-footer">{footer}</div>}
          </div>
        </div>
      )}

      <DesktopSidebar menu={menu} moduleAccess={moduleAccess} />
    </>
  );
}

/** Desktop keeps the full navigation tree inside the workspace sidebar. */
function DesktopSidebar({ menu, moduleAccess }: { menu: MenuSection[]; moduleAccess?: AgentModuleAccess }) {
  const tree = buildSidebarTree(menu, moduleAccess);
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside data-print-hide className={`portal-agent-sidebar-desktop portal-agent-desktop-nav hidden md:flex md:flex-col ${isCollapsed ? "is-collapsed" : ""}`}>
      <div className="portal-agent-sidebar-brand">
        <Link href={tree.home[0]?.path ?? "/app/dashboard"} aria-label="Insurvas home" className="portal-agent-desktop-brand-link">
          <InsurvasLogo size="sidebar" tone="dark" className="portal-agent-desktop-brand-full" />
          <InsurvasLogo size="compact" variant="symbol" tone="dark" className="portal-agent-desktop-brand-compact" />
        </Link>
        <button
          type="button"
          onClick={() => setIsCollapsed((collapsed) => !collapsed)}
          aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!isCollapsed}
          title={isCollapsed ? "Expand navigation" : "Collapse navigation"}
          className="portal-agent-sidebar-collapse rounded-md p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          {isCollapsed ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
        </button>
      </div>
      <div className="portal-agent-sidebar-scroll flex-1">
        <NavList
          menu={menu}
          moduleAccess={moduleAccess}
          isCollapsed={isCollapsed}
          onExpand={() => setIsCollapsed(false)}
        />
      </div>
      <div className="portal-agent-sidebar-account">
        {/* AppTopBar mounts the existing account control here. */}
        <div id="agent-rail-account" />
      </div>
    </aside>
  );
}

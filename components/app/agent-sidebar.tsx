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
  Landmark,
  LayoutDashboard,
  ListChecks,
  ListPlus,
  LockKeyhole,
  Menu,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
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
  X,
} from "lucide-react";

import type { MenuItem, MenuSection } from "@/lib/menu/definition";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { buildSidebarTree, initialOpenModule, NAV_BUSINESS_ICON, NAV_PARTNERS_ICON, type ModuleAccess, type SidebarModule, type SidebarTree } from "@/lib/menu/sidebar";

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
      {open && (children ? (
        <div id={sectionId} className="portal-agent-nav-disclosure-content">
          {children}
        </div>
      ) : (
        <ul id={sectionId} className={`portal-agent-nav-sublist ${nested ? "portal-agent-nav-sublist-nested" : ""}`}>
          {items.map((item) => (
            <NavItemLink
              key={item.key}
              item={item}
              nested
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ))}
    </section>
  );
}

function BusinessGroups({
  groups,
  onNavigate,
}: {
  groups: SidebarTree["business"];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const activeGroups = groups.filter((group) =>
    group.items.some((item) => isActivePath(pathname, item.path)),
  );
  const [openGroups, setOpenGroups] = useState<string[]>(() =>
    activeGroups.map((group) => group.label),
  );

  if (groups.length === 0) return null;

  return (
    <div className="portal-agent-nav-business-groups" aria-label="Business workspaces">
      {groups.map((group) => (
        <DisclosureSection
          key={group.label}
          label={group.label}
          icon={iconFor(group.icon)}
          items={group.items}
          open={openGroups.includes(group.label)}
          active={activeGroups.some((activeGroup) => activeGroup.label === group.label)}
          nested
          onToggle={() =>
            setOpenGroups((current) =>
              current.includes(group.label)
                ? current.filter((label) => label !== group.label)
                : [...current, group.label],
            )
          }
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

function ModuleSection({
  module,
  open,
  onToggle,
  onNavigate,
}: {
  module: SidebarModule;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const { id, items, status, disabled } = module;
  const Icon = iconFor(module.icon);

  return (
    <section className={`portal-agent-module portal-agent-module-${id}`}>
      <button
        type="button"
        className="portal-agent-module-button"
        aria-expanded={open}
        aria-controls={`agent-module-${id}`}
        aria-label={`${module.fullName}, ${status}`}
        title={module.fullName}
        aria-disabled={disabled}
        disabled={disabled}
        data-available={!disabled}
        data-open={open}
        onClick={onToggle}
      >
        <span className="portal-agent-module-icon" aria-hidden="true">
          {createElement(Icon, { className: "size-4" })}
        </span>
        <span className="portal-agent-module-copy">
          <span className="portal-agent-module-label">{module.label}</span>
          <span className="portal-agent-module-status">{status}</span>
        </span>
        {disabled ? (
          <LockKeyhole className="portal-agent-module-lock" aria-hidden="true" />
        ) : (
          <ChevronDown
            className={`portal-agent-nav-chevron ${open ? "is-open" : ""}`}
            aria-hidden="true"
          />
        )}
      </button>
      {open && items.length > 0 && (
        <ul id={`agent-module-${id}`} className="portal-agent-module-items">
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
 * — module headings, their order, Business groups, Partners — is data in `lib/menu/sidebar.ts`
 * (UX-3); this component renders `buildSidebarTree()` and only owns what is open.
 */
function NavList({
  menu,
  moduleAccess,
  onNavigate,
}: {
  menu: MenuSection[];
  moduleAccess?: AgentModuleAccess;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const tree = buildSidebarTree(menu, moduleAccess);
  const isActive = (item: MenuItem) => isActivePath(pathname, item.path);
  const activeBusiness = tree.business.some((group) => group.items.some(isActive));
  const activePartners = tree.partners.some(isActive);

  const [openModule, setOpenModule] = useState<string | null>(() => initialOpenModule(tree, isActive));
  const [businessOpen, setBusinessOpen] = useState(activeBusiness);
  const [partnersOpen, setPartnersOpen] = useState(activePartners);

  return (
    <nav className="portal-agent-nav" aria-label="Agent workspace navigation">
      <ul className="portal-agent-nav-home">
        {tree.home.map((item) => (
          <NavItemLink key={item.key} item={item} onNavigate={onNavigate} />
        ))}
      </ul>

      <div className="portal-agent-module-stack" aria-label="Licensed agent modules">
        {tree.modules.map((module) => (
          <ModuleSection
            key={module.id}
            module={module}
            open={openModule === module.id}
            onToggle={() => setOpenModule(openModule === module.id ? null : module.id)}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      {/* No rule between the modules and Business: the board runs the headings on at an even 8px. */}
      <DisclosureSection
        label="Business"
        icon={iconFor(NAV_BUSINESS_ICON)}
        items={[]}
        open={businessOpen}
        active={activeBusiness}
        onToggle={() => setBusinessOpen((value) => !value)}
        onNavigate={onNavigate}
      >
        <BusinessGroups groups={tree.business} onNavigate={onNavigate} />
      </DisclosureSection>
      <DisclosureSection
        label="Partners"
        icon={iconFor(NAV_PARTNERS_ICON)}
        items={tree.partners}
        open={partnersOpen}
        active={activePartners}
        onToggle={() => setPartnersOpen((value) => !value)}
        onNavigate={onNavigate}
      />

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
  "panel-left-close": PanelLeftClose,
  // Both LA-2 destinations. `iconFor()` falls back to a featureless Circle for an unknown name, so
  // a missing entry here is invisible in review and looks deliberate on screen.
  // `lib/design/contract.test.mjs` now fails when the menu names an icon this map lacks.
  store: Store,
  brain: Brain,
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
  const [collapsed, setCollapsed] = useState(false);

  // One mark everywhere the product names itself — the phone bar and drawer used a building icon.
  const brandMark = (
    <div className="flex items-center gap-2.5">
      <InsurvasLogo size="sidebar" />
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
        {brandMark}
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
                {brandMark}
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

      <aside
        data-print-hide
        className={`portal-agent-sidebar-desktop hidden shrink-0 flex-col md:flex ${collapsed ? "is-collapsed" : ""}`}
        data-collapsed={collapsed}
      >
        {/* The brand block sits OUTSIDE the scroll container: its hairline is the top edge of the
            rail, and an edge that scrolls away is not an edge. */}
        <div className="portal-agent-sidebar-brand">
            <div className="insurvas-agent-brand-full">{brandMark}</div>
            <InsurvasLogo size="compact" variant="symbol" className="insurvas-agent-brand-compact" />
            <button
              type="button"
              className="portal-agent-sidebar-collapse rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={collapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="size-4" aria-hidden="true" />
              )}
            </button>
        </div>
        <div className="portal-agent-sidebar-scroll min-h-0 flex-1">
          <NavList menu={menu} moduleAccess={moduleAccess} />
        </div>
        {/* Outside the scroll, as drawn: the list grows, the plan stays at the foot of the rail. */}
        {plan && <PlanCard plan={plan} />}
        {footer && <div className="portal-agent-sidebar-footer">{footer}</div>}
      </aside>
    </>
  );
}

"use client";

import { createElement, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
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

type ModuleId = "la1" | "la2";

export type AgentModuleAccess = {
  /** True when the effective tenant entitlement includes the inbound module. */
  inbound: boolean;
  /** True when the effective tenant entitlement includes the outbound module. */
  outbound: boolean;
};

const MODULE_FEATURES: Record<ModuleId, ReadonlySet<string>> = {
  la1: new Set(["inbound_transfers"]),
  la2: new Set(["outbound_dialing", "lead_import", "true_cpa"]),
};

const MODULE_COPY: Record<ModuleId, { label: string }> = {
  la1: { label: "LA-1 · Inbound operations" },
  la2: { label: "LA-2 · Outbound acquisition" },
};

// These destinations are shared by more than one insurance workflow. When the matching module
// is purchased, keep the high-frequency hand-off tools close to that module; when it is not,
// leave them in Business so a Book-of-Business-only tenant does not lose an existing route.
const LA1_SHARED_KEYS = new Set(["leads.workspace", "sell.callbacks"]);
const LA2_SHARED_KEYS = new Set(["sell.deal-flow"]);

const MODULE_ITEM_ORDER: Record<ModuleId, string[]> = {
  la1: ["leads.floor", "leads.inbound", "leads.workspace", "sell.callbacks", "leads.partner-chat"],
  la2: ["leads.dialer", "leads.import", "leads.nurture", "leads.assignments", "sell.deal-flow", "insight.true-cpa", "insight.vendor-returns", "insight.activity"],
};

const NAV_LABELS: Record<string, string> = {
  "home.dashboard": "Home",
  "leads.inbound": "Inbound inbox",
  "partners.publishers": "Publishers",
};

const BUSINESS_SECTION_ORDER = [
  "Book of Business",
  "Leads",
  "Sell",
  "Retention",
  "Insight",
  "Partners",
  "Accounting",
  "Compliance",
] as const;

const BUSINESS_SECTION_ICONS: Record<(typeof BUSINESS_SECTION_ORDER)[number], typeof BriefcaseBusiness> = {
  "Book of Business": BookOpen,
  Leads: ContactRound,
  Sell: Calculator,
  Retention: RotateCcw,
  Insight: ChartNoAxesCombined,
  Partners: Users,
  Accounting: Landmark,
  Compliance: ShieldCheck,
};

function iconFor(name: string) {
  return ICONS[name as keyof typeof ICONS] ?? Circle;
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function orderModuleItems(items: MenuItem[], id: ModuleId) {
  const order = MODULE_ITEM_ORDER[id];
  return [...items].sort((a, b) => {
    const aIndex = order.indexOf(a.key);
    const bIndex = order.indexOf(b.key);
    return (aIndex === -1 ? order.length : aIndex) - (bIndex === -1 ? order.length : bIndex);
  });
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
  const label = NAV_LABELS[item.key] ?? item.label;

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
  items,
  onNavigate,
}: {
  items: MenuItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = BUSINESS_SECTION_ORDER.map((label) => ({
    label,
    items: items.filter((item) => item.section === label),
  })).filter((group) => group.items.length > 0);
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
          icon={BUSINESS_SECTION_ICONS[group.label]}
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
  id,
  items,
  entitled,
  open,
  onToggle,
  onNavigate,
}: {
  id: ModuleId;
  items: MenuItem[];
  entitled: boolean;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const copy = MODULE_COPY[id];
  const visible = items.length > 0;
  const status = !entitled
    ? "Not included"
    : visible
      ? "Enabled"
      : "Role restricted";
  const disabled = !entitled || !visible;

  return (
    <section className={`portal-agent-module portal-agent-module-${id}`}>
      <button
        type="button"
        className="portal-agent-module-button"
        aria-expanded={open}
        aria-controls={`agent-module-${id}`}
        aria-label={`${copy.label}, ${status}`}
        aria-disabled={disabled}
        disabled={disabled}
        data-available={!disabled}
        data-open={open}
        onClick={onToggle}
      >
        <span className="portal-agent-module-icon" aria-hidden="true">
          {id === "la1" ? (
            <PhoneIncoming className="size-4" />
          ) : (
            <PhoneOutgoing className="size-4" />
          )}
        </span>
        <span className="portal-agent-module-copy">
          <span className="portal-agent-module-label">{copy.label}</span>
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
      {open && visible && (
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

function PlanAccessCard({
  planName,
  inboundEnabled,
  outboundEnabled,
}: {
  planName?: string | null;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
}) {
  return (
    <section className="portal-agent-plan-access" aria-label="Plan access">
      <div className="portal-agent-plan-access-heading">
        <ShieldCheck aria-hidden="true" />
        <strong>Plan access</strong>
        {planName && <span>{planName} plan</span>}
      </div>
      <p className={inboundEnabled ? "is-enabled" : "is-disabled"}>
        {inboundEnabled ? (
          <Check aria-hidden="true" />
        ) : (
          <LockKeyhole aria-hidden="true" />
        )}
        <span>{inboundEnabled ? "Inbound enabled" : "Inbound not included"}</span>
      </p>
      <p className={outboundEnabled ? "is-enabled" : "is-disabled"}>
        {outboundEnabled ? (
          <Check aria-hidden="true" />
        ) : (
          <LockKeyhole aria-hidden="true" />
        )}
        <span>{outboundEnabled ? "Outbound enabled" : "Outbound not included"}</span>
      </p>
    </section>
  );
}

/**
 * Entitlement-aware navigation for the licensed-agent shell.
 *
 * The server still supplies the filtered menu and every route keeps its own guard. This component
 * only changes how those already-authorized destinations are grouped and reached: LA-1 and LA-2
 * are module disclosures, while the less frequent sections stay behind Business and Partners.
 */
function NavList({
  menu,
  moduleAccess,
  planName,
  onNavigate,
}: {
  menu: MenuSection[];
  moduleAccess?: AgentModuleAccess;
  planName?: string | null;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const allItems = menu.flatMap((section) => section.items);
  const homeItems = allItems.filter((item) => item.section === "Home");
  const inboundEntitled = moduleAccess?.inbound ?? allItems.some(
    (item) => item.required_feature && MODULE_FEATURES.la1.has(item.required_feature),
  );
  const outboundEntitled = moduleAccess?.outbound ?? allItems.some(
    (item) => item.required_feature && MODULE_FEATURES.la2.has(item.required_feature),
  );
  const la1Items = orderModuleItems(allItems.filter(
    (item) =>
      (item.required_feature && MODULE_FEATURES.la1.has(item.required_feature)) ||
      (inboundEntitled && LA1_SHARED_KEYS.has(item.key)),
  ), "la1");
  const la2Items = orderModuleItems(allItems.filter(
    (item) =>
      (item.required_feature && MODULE_FEATURES.la2.has(item.required_feature)) ||
      (outboundEntitled && LA2_SHARED_KEYS.has(item.key)),
  ), "la2");
  const moduleKeys = new Set([...la1Items, ...la2Items].map((item) => item.key));
  const partnerItems = allItems.filter(
    (item) => item.section === "Partners" || item.key === "insight.partner-quality",
  );
  const partnerKeys = new Set(partnerItems.map((item) => item.key));
  const settingsItems = allItems.filter((item) => item.section === "Settings");
  const businessItems = allItems.filter(
    (item) =>
      item.section !== "Home" &&
      item.section !== "Settings" &&
      !moduleKeys.has(item.key) &&
      !partnerKeys.has(item.key),
  );

  const activeLa1 = la1Items.some((item) => isActivePath(pathname, item.path));
  const activeLa2 = la2Items.some((item) => isActivePath(pathname, item.path));
  const activeBusiness = businessItems.some((item) => isActivePath(pathname, item.path));
  const activePartners = partnerItems.some((item) => isActivePath(pathname, item.path));
  const activeModule: ModuleId | null = activeLa1 ? "la1" : activeLa2 ? "la2" : null;

  const [openModule, setOpenModule] = useState<ModuleId | null>(
    activeModule ?? (la1Items.length > 0 ? "la1" : la2Items.length > 0 ? "la2" : null),
  );
  const [businessOpen, setBusinessOpen] = useState(activeBusiness);
  const [partnersOpen, setPartnersOpen] = useState(activePartners);

  const entitlement = moduleAccess ?? {
    inbound: inboundEntitled,
    outbound: outboundEntitled,
  };
  const inboundEnabled = entitlement.inbound && la1Items.length > 0;
  const outboundEnabled = entitlement.outbound && la2Items.length > 0;

  return (
    <nav className="portal-agent-nav" aria-label="Agent workspace navigation">
      <ul className="portal-agent-nav-home">
        {homeItems.map((item) => (
          <NavItemLink key={item.key} item={item} onNavigate={onNavigate} />
        ))}
      </ul>

      <div className="portal-agent-module-stack" aria-label="Licensed agent modules">
        <ModuleSection
          id="la1"
          items={la1Items}
          entitled={entitlement.inbound}
          open={openModule === "la1"}
          onToggle={() => setOpenModule(openModule === "la1" ? null : "la1")}
          onNavigate={onNavigate}
        />
        <ModuleSection
          id="la2"
          items={la2Items}
          entitled={entitlement.outbound}
          open={openModule === "la2"}
          onToggle={() => setOpenModule(openModule === "la2" ? null : "la2")}
          onNavigate={onNavigate}
        />
      </div>

      <div className="portal-agent-nav-divider" />

      <DisclosureSection
        label="Business"
        icon={BriefcaseBusiness}
        items={[]}
        open={businessOpen}
        active={activeBusiness}
        onToggle={() => setBusinessOpen((value) => !value)}
        onNavigate={onNavigate}
      >
        <BusinessGroups items={businessItems} onNavigate={onNavigate} />
      </DisclosureSection>
      <DisclosureSection
        label="Partners"
        icon={Users}
        items={partnerItems}
        open={partnersOpen}
        active={activePartners}
        onToggle={() => setPartnersOpen((value) => !value)}
        onNavigate={onNavigate}
      />

      {settingsItems.map((item) => (
        <ul key={item.key} className="portal-agent-nav-settings">
          <NavItemLink item={item} onNavigate={onNavigate} />
        </ul>
      ))}

      <PlanAccessCard
        planName={planName}
        inboundEnabled={inboundEnabled}
        outboundEnabled={outboundEnabled}
      />
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
  planName,
}: {
  menu: MenuSection[];
  footer?: ReactNode;
  moduleAccess?: AgentModuleAccess;
  planName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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
          className="-ml-1 rounded-md p-1.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2">
          <Building2 className="size-4" aria-hidden="true" />
          <span className="font-semibold tracking-tight">Insurvas</span>
        </div>
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
              <div className="portal-agent-sidebar-brand mb-6 px-3">
                <div className="flex items-center gap-2">
                  <Building2 className="size-5" aria-hidden="true" />
                  <span className="font-semibold tracking-tight">Insurvas</span>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="rounded-md p-1.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <NavList
                menu={menu}
                moduleAccess={moduleAccess}
                planName={planName}
                onNavigate={() => setOpen(false)}
              />
            </div>
            {footer && <div className="portal-agent-sidebar-footer mt-6 pt-4">{footer}</div>}
          </div>
        </div>
      )}

      <aside
        data-print-hide
        className={`portal-agent-sidebar-desktop hidden shrink-0 flex-col text-foreground md:flex ${collapsed ? "is-collapsed" : ""}`}
        data-collapsed={collapsed}
      >
        <div className="portal-agent-sidebar-scroll min-h-0 flex-1">
          <div className="portal-agent-sidebar-brand mb-7 px-3">
            <div className="flex items-center gap-2">
              <Building2 className="size-5" aria-hidden="true" />
              <span className="font-semibold tracking-tight">Insurvas</span>
            </div>
            <button
              type="button"
              className="portal-agent-sidebar-collapse rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
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
          <NavList menu={menu} moduleAccess={moduleAccess} planName={planName} />
        </div>
        {footer && <div className="portal-agent-sidebar-footer mt-4 pt-4">{footer}</div>}
      </aside>
    </>
  );
}

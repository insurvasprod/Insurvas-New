"use client";

import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
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
}: {
  menu: MenuSection[];
  moduleAccess?: AgentModuleAccess;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const tree = buildSidebarTree(menu, moduleAccess);
  const isActive = (item: MenuItem) => isActivePath(pathname, item.path);
  const [openGroups, setOpenGroups] = useState<string[]>(() => initialOpenGroups(tree, isActive));

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
          open={openGroups.includes(group.label)}
          active={group.items.some(isActive)}
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

      <NavRail menu={menu} moduleAccess={moduleAccess} />
    </>
  );
}

type RailFlyout =
  | { kind: "group"; key: string; label: string; items: MenuItem[]; top: number }
  | { kind: "tip"; key: string; label: string; top: number };

/**
 * The desktop rail (redesign 2026-10-25, owner's pick "Dashboard A"): one icon per job group, Home
 * at the top and Settings and your account at the foot (the plan is a line in the account menu). Pointing at a group, focusing it or clicking it
 * opens its pages beside the rail — every page in one move, no groups to expand and collapse.
 * The phone keeps the full drawer above. The menu is the same server-filtered `buildSidebarTree()`.
 *
 * The panel is position: fixed so the rail's own scroll (short screens) never clips it.
 */
function NavRail({ menu, moduleAccess }: { menu: MenuSection[]; moduleAccess?: AgentModuleAccess }) {
  const pathname = usePathname();
  const tree = buildSidebarTree(menu, moduleAccess);
  const [fly, setFly] = useState<RailFlyout | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  const closeTimer = useRef<number | null>(null);
  const isActive = (item: MenuItem) => isActivePath(pathname, item.path);

  // A navigation closes the panel (set during render, not in an effect: it is derived from the path).
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setFly(null);
  }

  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);

  const cancelClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  // A short grace, so the pointer can cross the gap between the rail and the panel.
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setFly(null), 160);
  };
  const place = (element: HTMLElement, rows: number) => {
    const rect = element.getBoundingClientRect();
    const height = 56 + rows * 40;
    return Math.max(8, Math.min(rect.top - 8, window.innerHeight - height - 12));
  };
  const openGroup = (group: { label: string; items: MenuItem[] }, element: HTMLElement) => {
    cancelClose();
    setFly({ kind: "group", key: group.label, label: group.label, items: group.items, top: place(element, group.items.length) });
  };
  const openTip = (key: string, label: string, element: HTMLElement) => {
    cancelClose();
    const rect = element.getBoundingClientRect();
    setFly((current) => (current?.kind === "group" && current.key === key ? current : { kind: "tip", key, label, top: rect.top + rect.height / 2 - 16 }));
  };

  function onKeyDown(event: React.KeyboardEvent) {
    // Into the open panel from its group's button.
    if ((event.key === "ArrowRight" || event.key === "ArrowDown") && fly?.kind === "group" && (event.target as HTMLElement).dataset.railKey === fly.key) {
      const first = document.querySelector<HTMLElement>("#agent-rail-panel a");
      if (first) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key !== "Escape" || !fly) return;
    const key = fly.key;
    setFly(null);
    document.querySelector<HTMLElement>(`[data-rail-key="${CSS.escape(key)}"]`)?.focus();
  }

  const link = (item: MenuItem) => {
    const Icon = iconFor(item.icon);
    const active = isActive(item);
    const label = item.navLabel ?? item.label;
    return (
      <li key={item.key}>
        <Link
          href={item.path}
          data-rail-key={item.key}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={`portal-agent-rail-item ${active ? "is-active" : ""}`}
          onPointerEnter={(event) => openTip(item.key, label, event.currentTarget)}
          onPointerLeave={closeSoon}
          onFocus={(event) => openTip(item.key, label, event.currentTarget)}
          onBlur={closeSoon}
        >
          {createElement(Icon, { className: "size-5", "aria-hidden": true })}
        </Link>
      </li>
    );
  };

  return (
    <aside data-print-hide className="portal-agent-rail hidden md:flex" onKeyDown={onKeyDown}>
      <div className="portal-agent-rail-brand">
        <Link href={tree.home[0]?.path ?? "/app/dashboard"} aria-label="Insurvas home">
          <InsurvasLogo size="compact" variant="symbol" tone="dark" />
        </Link>
      </div>
      <nav className="portal-agent-rail-scroll" aria-label="Agent workspace navigation">
        <ul className="portal-agent-rail-list">
          {tree.home.map(link)}
          {tree.groups.map((group) => {
            const Icon = iconFor(group.icon);
            const open = fly?.kind === "group" && fly.key === group.label;
            const active = group.items.some(isActive);
            return (
              <li key={group.label}>
                <button
                  type="button"
                  onClick={(event) => (open ? setFly(null) : openGroup(group, event.currentTarget))}
                  data-rail-key={group.label}
                  aria-label={group.label}
                  aria-expanded={open}
                  aria-controls={open ? "agent-rail-panel" : undefined}
                  className={`portal-agent-rail-item ${active ? "is-active" : ""}`}
                  onPointerEnter={(event) => openGroup(group, event.currentTarget)}
                  onPointerLeave={closeSoon}
                  onFocus={(event) => openGroup(group, event.currentTarget)}
                >
                  <Icon className="size-5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <ul className="portal-agent-rail-foot">
        {tree.settings.map(link)}
        {/* The account (owner ask 2026-10-26): the top bar portals its account button and menu into
            this slot (AppTopBar accountHostId). The plan is a line in that menu, not an icon here. */}
        <li id="agent-rail-account" className="portal-agent-rail-account" />
      </ul>

      {fly && (
        <div
          id="agent-rail-panel"
          className="portal-agent-rail-fly m-swap"
          data-kind={fly.kind}
          style={{ top: fly.top }}
          role={fly.kind === "tip" ? "tooltip" : "group"}
          aria-label={fly.kind === "tip" ? undefined : fly.label}
          onPointerEnter={cancelClose}
          onPointerLeave={closeSoon}
        >
          {fly.kind === "tip" && fly.label}
          {fly.kind === "group" && (
            <>
              <p className="portal-agent-rail-fly-head">{fly.label}</p>
              <ul>
                {fly.items.map((item) => {
                  const Icon = iconFor(item.icon);
                  const active = isActive(item);
                  return (
                    <li key={item.key}>
                      <Link href={item.path} aria-current={active ? "page" : undefined} onClick={() => setFly(null)} onBlur={closeSoon} onFocus={cancelClose}>
                        {createElement(Icon, { className: "size-4 shrink-0", "aria-hidden": true })}
                        <span>{item.navLabel ?? item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </aside>
  );
}

"use client";

import { createElement, Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  Brain,
  BriefcaseBusiness,
  Building2,
  Calculator,
  DollarSign,
  House,
  Phone,
  CalendarCheck,
  UserRoundCheck,
  CalendarClock,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronsUpDown,
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
  PanelLeftClose,
  PanelLeftOpen,
  PhoneIncoming,
  PhoneOutgoing,
  Pin,
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
import { buildSidebarAreas, buildSidebarTree, type ModuleAccess, type SidebarArea, type SidebarTree } from "@/lib/menu/sidebar";
import { NAV_COLLAPSED_COOKIE, OPEN_WORKSPACES_EVENT } from "@/lib/menu/navEvents";
import { useNavStatus } from "@/components/app/nav/use-nav-status";

/** Which acquisition modules the effective tenant entitlement includes (inbound, outbound). */
export type AgentModuleAccess = ModuleAccess;

function iconFor(name: string) {
  return ICONS[name as keyof typeof ICONS] ?? Circle;
}

/** A page's icon in the rail; Home is the house (NavB, 2026-10-28) rather than the dashboard grid. */
function itemIcon(item: MenuItem) {
  return item.key === "home.dashboard" ? House : iconFor(item.icon);
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const labelOf = (item: MenuItem) => item.navLabel ?? item.label;

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

// ---- pins: this person's shortcuts, in this browser ------------------------------------------------

const MAX_PINS = 6;
const pinKey = (userId?: string) => `insurvas.nav.pins.v1:${userId ?? "me"}`;

/**
 * Pages pinned to the top of the menu (Navigation A). A convenience kept in this browser, keyed by
 * the person: storage can be missing or blocked, so every read and write is guarded and the menu
 * works without it. A pin for a page this person can no longer open simply is not drawn.
 */
function usePins(userId?: string): [string[], (key: string) => void] {
  const [pins, setPins] = useState<string[]>([]);
  useEffect(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(pinKey(userId)) ?? "[]") as unknown;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from storage after mount, never during render
      if (Array.isArray(parsed)) setPins(parsed.filter((key): key is string => typeof key === "string").slice(0, MAX_PINS));
    } catch { /* no pins is the honest fallback */ }
  }, [userId]);
  const toggle = (key: string) => {
    setPins((current) => {
      const next = current.includes(key) ? current.filter((pinned) => pinned !== key) : [...current, key].slice(-MAX_PINS);
      try { window.localStorage.setItem(pinKey(userId), JSON.stringify(next)); } catch { /* kept for this visit only */ }
      return next;
    });
  };
  return [pins, toggle];
}

// ---- the labelled menu (the sidebar, and the phone drawer) -----------------------------------------

/** How loud a count is (owner 2026-10-28): green for a little waiting, then yellow, orange, red. */
function countTone(n: number) {
  return n >= 50 ? "red" : n >= 20 ? "orange" : n >= 10 ? "yellow" : "green";
}

function Count({ n }: { n: number | undefined }) {
  if (!n) return null;
  return <span className="portal-nav-count" data-tone={countTone(n)} aria-label={`${n} waiting`}>{n > 99 ? "99+" : n}</span>;
}

/**
 * Navigation A (owner's pick 2026-10-28): every page by name, in its job group, with what waits on it.
 * Home, the pages you pinned, the groups (fold any of them), and Settings at the foot. The menu is the
 * server-filtered `buildSidebarTree()`; nothing here grants or hides a page.
 */
function NavTree({
  tree,
  pins,
  togglePin,
  onNavigate,
}: {
  tree: SidebarTree;
  pins: string[];
  togglePin: (key: string) => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { counts } = useNavStatus();
  const isActive = (item: MenuItem) => isActivePath(pathname, item.path);
  const areas = buildSidebarAreas(tree);
  const [openGroups, setOpenGroups] = useState<string[]>(() => {
    const holder = areas.find((area) => area.items.some(isActive));
    return holder ? [holder.label] : areas[0] ? [areas[0].label] : [];
  });
  const [seenPath, setSeenPath] = useState(pathname);
  // Arriving on a page opens its area (derived from the path, so set during render).
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    const holder = areas.find((area) => area.items.some((item) => isActivePath(pathname, item.path)));
    if (holder && !openGroups.includes(holder.label)) setOpenGroups([...openGroups, holder.label]);
  }

  const everything = [...tree.home, ...tree.groups.flatMap((group) => group.items), ...tree.settings];
  const pinned = pins.flatMap((key) => everything.filter((item) => item.key === key));

  const row = (item: MenuItem, withIcon: boolean) => {
    const label = labelOf(item);
    const isPinned = pins.includes(item.key);
    return (
      <li key={item.key} className="portal-nav-row">
        <Link
          href={item.path}
          onClick={onNavigate}
          aria-current={isActive(item) ? "page" : undefined}
          title={label.length > 22 ? label : undefined}
          className={`portal-nav-link ${withIcon ? "" : "portal-nav-link-sub"}`}
        >
          {withIcon && createElement(itemIcon(item), { className: "portal-nav-icon", "aria-hidden": true })}
          <span className="portal-nav-label">{label}</span>
          <Count n={counts[item.key]} />
        </Link>
        <button
          type="button"
          onClick={() => togglePin(item.key)}
          aria-pressed={isPinned}
          aria-label={isPinned ? `Unpin ${label}` : `Pin ${label} to the top`}
          title={isPinned ? "Unpin" : "Pin to the top"}
          className="portal-nav-pin"
        >
          <Pin className="size-3.5" aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <div className="portal-nav-tree">
      <ul className="portal-nav-list">{tree.home.map((item) => row(item, true))}</ul>

      {pinned.length > 0 && (
        <section aria-label="Pinned" className="portal-nav-pinned">
          <p className="portal-nav-heading">Pinned</p>
          <ul className="portal-nav-list">{pinned.map((item) => row(item, true))}</ul>
        </section>
      )}

      {areas.map((area) => {
        const open = openGroups.includes(area.label);
        const id = `agent-nav-${area.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        const total = area.items.reduce((sum, item) => sum + (counts[item.key] ?? 0), 0);
        return (
          <section key={area.label} className="portal-nav-group" data-active={area.items.some(isActive) || undefined}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpenGroups((current) => (open ? current.filter((label) => label !== area.label) : [...current, area.label]))}
              className="portal-nav-group-head"
            >
              {createElement(iconFor(area.icon), { className: "portal-nav-icon", "aria-hidden": true })}
              <span className="portal-nav-label">{area.label}</span>
              {!open && <Count n={total} />}
              <ChevronDown className={`portal-nav-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
            </button>
            {/* An area of two job groups keeps each group's name as a small heading over its pages. */}
            {open && (
              <ul id={id} className="portal-nav-sub">
                {area.groups.map((group) => (
                  <Fragment key={group.label}>
                    {area.groups.length > 1 && <li className="portal-nav-subhead">{group.label}</li>}
                    {group.items.map((item) => row(item, false))}
                  </Fragment>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
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
  // The six areas' icons (NavB, 2026-10-28): Work, Money and Team; Leads, Book and Compliance reuse
  // users, book-open and shield-check above.
  phone: Phone,
  "dollar-sign": DollarSign,
  building: Building2,
} as const;

function workspaceInitials(name: string) {
  const words = name.replace(/&/g, " ").trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

export function AgentSidebar({
  menu,
  footer,
  moduleAccess,
  plan,
  userId,
  workspaceName,
  initialCollapsed = false,
}: {
  menu: MenuSection[];
  footer?: ReactNode;
  moduleAccess?: AgentModuleAccess;
  plan?: AgentPlanSummary;
  /** Keys this browser's pins to the person. */
  userId?: string;
  /** The workspace card at the top of the sidebar. */
  workspaceName?: string;
  /** From the cookie, so a collapsed sidebar draws collapsed on the first paint. */
  initialCollapsed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tree = buildSidebarTree(menu, moduleAccess);
  const [pins, togglePin] = usePins(userId);

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
            {/* No min-h-0: the list keeps its height and the drawer scrolls, rather than the plan card
                drawing over the last groups. */}
            <div className="flex-1">
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
              <nav aria-label="Agent workspace navigation" className="portal-nav-drawer">
                <NavTree tree={tree} pins={pins} togglePin={togglePin} onNavigate={() => setOpen(false)} />
                <ul className="portal-nav-list">
                  {tree.settings.map((item) => (
                    <li key={item.key} className="portal-nav-row">
                      <Link href={item.path} onClick={() => setOpen(false)} className="portal-nav-link">
                        {createElement(iconFor(item.icon), { className: "portal-nav-icon", "aria-hidden": true })}
                        <span className="portal-nav-label">{labelOf(item)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
            {plan && <PlanCard plan={plan} />}
            {footer && <div className="portal-agent-sidebar-footer">{footer}</div>}
          </div>
        </div>
      )}

      <NavRail tree={tree} pins={pins} togglePin={togglePin} plan={plan} workspaceName={workspaceName} initialCollapsed={initialCollapsed} />
    </>
  );
}

type RailFlyout = { key: string; area: SidebarArea; top: number };

/**
 * The desktop menu. Expanded (the default, Navigation A 2026-10-28): the labelled sidebar — your
 * workspace, Home, pins, the six areas (NavB's names and icons) with their counts, Settings and your
 * account at the foot. Collapsed (one click, remembered): the rail, each area an icon over its name,
 * whose pages open beside it on hover, focus or click, with a badge counting what waits inside.
 * The phone keeps the full drawer above. The menu is the same server-filtered `buildSidebarTree()`.
 *
 * The flyout is position: fixed so the rail's own scroll (short screens) never clips it.
 */
function NavRail({
  tree,
  pins,
  togglePin,
  plan,
  workspaceName,
  initialCollapsed,
}: {
  tree: SidebarTree;
  pins: string[];
  togglePin: (key: string) => void;
  plan?: AgentPlanSummary;
  workspaceName?: string;
  initialCollapsed: boolean;
}) {
  const pathname = usePathname();
  const { counts } = useNavStatus();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
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

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    setFly(null);
    document.cookie = `${NAV_COLLAPSED_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; SameSite=Lax`;
  }

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
  const areas = buildSidebarAreas(tree);
  const openArea = (area: SidebarArea, element: HTMLElement) => {
    cancelClose();
    const rows = area.items.length + (area.groups.length > 1 ? area.groups.length : 0);
    setFly({ key: area.label, area, top: place(element, rows) });
  };

  function onKeyDown(event: React.KeyboardEvent) {
    // Into the open panel from its area's button.
    if ((event.key === "ArrowRight" || event.key === "ArrowDown") && fly && (event.target as HTMLElement).dataset.railKey === fly.key) {
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
    const Icon = itemIcon(item);
    const active = isActive(item);
    const label = labelOf(item);
    return (
      <li key={item.key}>
        <Link
          href={item.path}
          data-rail-key={item.key}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          className={`portal-agent-rail-item ${active ? "is-active" : ""}`}
        >
          <span className="portal-nav-rail-icon">
            {createElement(Icon, { className: "size-5", "aria-hidden": true })}
            {counts[item.key] ? <span className="portal-nav-dot" data-tone={countTone(counts[item.key])} aria-hidden="true">{counts[item.key] > 99 ? "99+" : counts[item.key]}</span> : null}
          </span>
          <span className="portal-nav-rail-label" aria-hidden="true">{label}</span>
        </Link>
      </li>
    );
  };

  const toggle = (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
      aria-expanded={!collapsed}
      title={collapsed ? "Expand the menu" : "Collapse the menu"}
      className="portal-nav-toggle"
    >
      {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden="true" /> : <PanelLeftClose className="size-[18px]" aria-hidden="true" />}
    </button>
  );

  return (
    <aside data-print-hide data-collapsed={collapsed ? "true" : "false"} className="portal-agent-rail portal-nav hidden md:flex" onKeyDown={onKeyDown}>
      <div className="portal-agent-rail-brand">
        <Link href={tree.home[0]?.path ?? "/app/dashboard"} aria-label="Insurvas home">
          {collapsed ? <InsurvasLogo size="compact" variant="symbol" tone="dark" /> : <InsurvasLogo size="sidebar" tone="dark" />}
        </Link>
        {!collapsed && toggle}
      </div>

      {!collapsed && workspaceName && (
        <button
          type="button"
          data-account-trigger
          onClick={() => window.dispatchEvent(new CustomEvent(OPEN_WORKSPACES_EVENT))}
          className="portal-nav-workspace"
          aria-label={`${workspaceName}: your account and workspaces`}
        >
          <span className="portal-nav-workspace-mark" aria-hidden="true">{workspaceInitials(workspaceName)}</span>
          <span className="portal-nav-workspace-text">
            <span className="portal-nav-workspace-name">{workspaceName}</span>
            {plan && <span className="portal-nav-workspace-meta">{[plan.name, plan.roleLabel].filter(Boolean).join(" · ")}</span>}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      )}

      <nav className="portal-agent-rail-scroll" aria-label="Agent workspace navigation">
        {collapsed ? (
          <ul className="portal-agent-rail-list">
            <li>{toggle}</li>
            {tree.home.map(link)}
            {areas.map((area) => {
              const Icon = iconFor(area.icon);
              const open = fly?.key === area.label;
              const active = area.items.some(isActive);
              const total = area.items.reduce((sum, item) => sum + (counts[item.key] ?? 0), 0);
              return (
                <li key={area.label}>
                  <button
                    type="button"
                    onClick={(event) => (open ? setFly(null) : openArea(area, event.currentTarget))}
                    data-rail-key={area.label}
                    aria-label={total ? `${area.label}, ${total} waiting` : area.label}
                    aria-expanded={open}
                    aria-controls={open ? "agent-rail-panel" : undefined}
                    className={`portal-agent-rail-item ${active ? "is-active" : ""}`}
                    onPointerEnter={(event) => openArea(area, event.currentTarget)}
                    onPointerLeave={closeSoon}
                    onFocus={(event) => openArea(area, event.currentTarget)}
                  >
                    <span className="portal-nav-rail-icon">
                      <Icon className="size-5" aria-hidden="true" />
                      {total > 0 && <span className="portal-nav-dot" data-tone={countTone(total)} aria-hidden="true">{total > 99 ? "99+" : total}</span>}
                    </span>
                    <span className="portal-nav-rail-label" aria-hidden="true">{area.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <NavTree tree={tree} pins={pins} togglePin={togglePin} />
        )}
      </nav>
      <ul className="portal-agent-rail-foot">
        {collapsed
          ? tree.settings.map(link)
          : tree.settings.map((item) => (
            <li key={item.key} className="portal-nav-row">
              <Link href={item.path} aria-current={isActive(item) ? "page" : undefined} className="portal-nav-link">
                {createElement(iconFor(item.icon), { className: "portal-nav-icon", "aria-hidden": true })}
                <span className="portal-nav-label">{labelOf(item)}</span>
              </Link>
            </li>
          ))}
        {/* The account (owner ask 2026-10-26): the top bar portals its account button and menu into
            this slot (AppTopBar accountHostId). The plan is a line in that menu, not an icon here.
            The slot stays mounted through a collapse, so the portal never loses its host. */}
        <li id="agent-rail-account" className="portal-agent-rail-account" />
      </ul>

      {fly && (
        <div
          id="agent-rail-panel"
          className="portal-agent-rail-fly m-swap"
          data-kind="group"
          style={{ top: fly.top }}
          role="group"
          aria-label={fly.key}
          onPointerEnter={cancelClose}
          onPointerLeave={closeSoon}
        >
          <p className="portal-agent-rail-fly-head">{fly.area.label}</p>
          {fly.area.groups.map((group) => (
            <Fragment key={group.label}>
              {fly.area.groups.length > 1 && <p className="portal-nav-fly-subhead">{group.label}</p>}
              <ul>
                {group.items.map((item) => {
                  const Icon = iconFor(item.icon);
                  const active = isActive(item);
                  return (
                    <li key={item.key}>
                      <Link href={item.path} aria-current={active ? "page" : undefined} onClick={() => setFly(null)} onBlur={closeSoon} onFocus={cancelClose}>
                        {createElement(Icon, { className: "size-4 shrink-0", "aria-hidden": true })}
                        <span>{labelOf(item)}</span>
                        <Count n={counts[item.key]} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Fragment>
          ))}
        </div>
      )}
    </aside>
  );
}

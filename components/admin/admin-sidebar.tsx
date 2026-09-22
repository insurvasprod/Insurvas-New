"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Building2,
  ChevronDown,
  ChevronRight,
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
  ShieldCheck,
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

import { LogoutButton } from "./logout-button";
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
const DEFAULT_OPEN_GROUPS = ["customers", "billing"];

const ACTIVE_STYLE = {
  borderColor: "transparent",
  background: "var(--soft-orange-surface)",
  boxShadow: "inset 2px 0 0 var(--primary)",
} as const;

type Props = { nodes: SidebarNode[]; adminName: string; roleLabel: string };

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

  function renderMobileNavigation() {
    return nodes.map((node) => {
      if (node.kind === "link") {
        const Icon = ICONS[node.icon];
        const active = isLinkActive(node.href, pathname);

        return (
          <Link
            key={node.href}
            href={node.href}
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 rounded-[14px] border px-4 py-3 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
            style={{
              borderColor: active ? ACTIVE_STYLE.borderColor : "transparent",
              background: active ? ACTIVE_STYLE.background : "transparent",
              boxShadow: active ? ACTIVE_STYLE.boxShadow : "none",
              fontWeight: active ? 700 : 600,
              color: active ? "var(--primary)" : "var(--ink)",
            }}
          >
            <Icon size={20} strokeWidth={1.8} className="shrink-0" />
            <span className="truncate">{node.label}</span>
          </Link>
        );
      }

      const Icon = ICONS[node.icon];
      const open = isOpen(node.id);

      return (
        <div key={node.id} className="relative">
          <button
            type="button"
            onClick={() => toggleGroup(node.id)}
            aria-expanded={open}
            className="flex w-full items-center gap-3 rounded-[14px] border border-transparent px-4 py-3 text-left text-[15px] font-semibold transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
          >
            <Icon size={20} strokeWidth={1.8} className="shrink-0" />
            <span className="truncate">{node.label}</span>
            {open ? <ChevronDown size={14} className="ml-auto shrink-0 opacity-70" /> : <ChevronRight size={14} className="ml-auto shrink-0 opacity-70" />}
          </button>
          {open && (
            <div className="mt-1 flex flex-col gap-1">
              {node.links.map((entry) => {
                const active = isLinkActive(entry.href, pathname);
                return (
                  <Link
                    key={entry.href}
                    href={entry.href}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 rounded-[14px] border py-2.5 pl-11 pr-4 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    style={{
                      borderColor: active ? ACTIVE_STYLE.borderColor : "transparent",
                      background: active ? ACTIVE_STYLE.background : "transparent",
                      boxShadow: active ? ACTIVE_STYLE.boxShadow : "none",
                      fontWeight: active ? 700 : 500,
                      color: "rgba(255,255,255,0.92)",
                    }}
                  >
                    <span className="truncate">{entry.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    });
  }

  /**
   * The section you are currently inside is always open, whatever was remembered.
   *
   * Deliberately not "opened once, then closeable": collapsing the group that holds the page you
   * are looking at hides your own location in the tree, and a deep link would otherwise land you
   * in a section that appears shut. Every other group is yours to open and close.
   */
  const isOpen = (id: string) => openGroups.includes(id) || id === activeGroupId;

  function renderLink(entry: Extract<SidebarNode, { kind: "link" }>, nested: boolean) {
    const Icon = ICONS[entry.icon];
    const active = isLinkActive(entry.href, pathname);

    return (
      <Link
        key={entry.href}
        href={entry.href}
        aria-current={active ? "page" : undefined}
        title={collapsed ? entry.label : undefined}
        className={`flex items-center gap-3 rounded-[14px] border text-[15px] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] ${
          collapsed ? "justify-center px-0 py-3" : nested ? "py-2.5 pl-11 pr-4" : "px-4 py-3"
        }`}
        style={{
          borderColor: active ? ACTIVE_STYLE.borderColor : "transparent",
          background: active ? ACTIVE_STYLE.background : "transparent",
          boxShadow: active ? ACTIVE_STYLE.boxShadow : "none",
          fontWeight: active ? 700 : nested ? 500 : 600,
          color: active ? "var(--primary)" : nested ? "var(--muted)" : "var(--ink)",
        }}
        onMouseEnter={(event) => {
          if (active) return;
          event.currentTarget.style.background = "var(--surface-alt)";
        }}
        onMouseLeave={(event) => {
          if (active) return;
          event.currentTarget.style.background = "transparent";
        }}
      >
        {(!nested || collapsed) && <Icon size={20} strokeWidth={1.8} className="shrink-0" />}
        {!collapsed && <span className="truncate">{entry.label}</span>}
      </Link>
    );
  }

  return (
    <>
      <header
        data-print-hide
        className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card px-4 py-3 text-foreground md:hidden"
      >
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open admin menu"
          aria-expanded={mobileOpen}
          className="-ml-1 rounded-md p-1.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4" aria-hidden="true" />
          <span className="font-semibold tracking-tight">Insurvas Admin</span>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close admin menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside
            data-print-hide
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col justify-between overflow-y-auto p-4 text-foreground shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
            style={{
              background:
                "var(--surface)",
            }}
          >
            <div>
              <div className="mb-6 flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-5" aria-hidden="true" />
                  <span className="font-semibold tracking-tight">Insurvas Admin</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close admin menu"
                  className="rounded-md p-1.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>
              <nav className="flex flex-col gap-1" aria-label="Admin navigation">
                {renderMobileNavigation()}
              </nav>
            </div>
            <div className="mt-6 border-t border-border pt-4">
              <p className="truncate px-2 text-sm font-medium">{adminName}</p>
              <p className="px-2 text-xs text-muted-foreground">{roleLabel}</p>
              <div className="mt-3 px-2">
                <LogoutButton />
              </div>
            </div>
          </aside>
        </div>
      )}

      <aside
        data-print-hide
        className={`relative hidden shrink-0 flex-col justify-between border-r border-border p-4 text-foreground transition-[width] duration-200 md:flex ${
          collapsed ? "w-[76px]" : "w-60"
        }`}
        style={{
          background:
            "var(--surface)",
        }}
      >
      <div>
        <div className={`mb-8 flex items-center gap-2 px-2 ${collapsed ? "justify-center" : ""}`}>
          <ShieldCheck className="size-5 shrink-0" />
          {!collapsed && <span className="font-semibold tracking-tight">Insurvas Admin</span>}
        </div>

        <nav className="flex flex-col gap-1">
          {nodes.map((node) => {
            if (node.kind === "link") return renderLink(node, false);

            const Icon = ICONS[node.icon];
            const open = isOpen(node.id);
            const containsActive = node.id === activeGroupId;

            return (
              <div
                key={node.id}
                className="relative"
                onMouseEnter={() => collapsed && setFlyout(node.id)}
                onMouseLeave={() => collapsed && setFlyout(null)}
              >
                <button
                  type="button"
                  onClick={() => (collapsed ? toggleCollapsed() : toggleGroup(node.id))}
                  title={collapsed ? node.label : undefined}
                  aria-expanded={collapsed ? undefined : open}
                  className={`flex w-full items-center gap-3 rounded-[14px] border border-transparent text-[15px] font-semibold transition-all hover:bg-muted ${
                    collapsed ? "justify-center px-0 py-3" : "px-4 py-3"
                  }`}
                  style={{
                    // In the rail there are no child links to show the active state, so the group
                    // itself carries it — otherwise the whole sidebar looks unselected.
                    background: collapsed && containsActive ? ACTIVE_STYLE.background : undefined,
                    borderColor: collapsed && containsActive ? ACTIVE_STYLE.borderColor : undefined,
                  }}
                >
                  <Icon size={20} strokeWidth={1.8} className="shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="truncate">{node.label}</span>
                      {open ? (
                        <ChevronDown size={14} className="ml-auto shrink-0 opacity-70" />
                      ) : (
                        <ChevronRight size={14} className="ml-auto shrink-0 opacity-70" />
                      )}
                    </>
                  )}
                </button>

                {!collapsed && open && (
                  <div className="mt-1 flex flex-col gap-1">
                    {node.links.map((entry) => renderLink(entry, true))}
                  </div>
                )}

                {collapsed && flyout === node.id && (
                  <div
                    className="absolute left-full top-0 z-50 ml-2 w-56 rounded-[16px] border border-border p-2 shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
                    style={{ background: "var(--surface)" }}
                  >
                    <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {node.label}
                    </p>
                    {node.links.map((entry) => {
                      const active = isLinkActive(entry.href, pathname);
                      return (
                        <Link
                          key={entry.href}
                          href={entry.href}
                          className="block rounded-[10px] px-3 py-2 text-sm transition-colors hover:bg-muted"
                          style={{
                            fontWeight: active ? 700 : 500,
                            background: active ? "var(--soft-orange-surface)" : "transparent",
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
          })}
        </nav>
      </div>

      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`mb-3 flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          {!collapsed && <span>Collapse</span>}
        </button>

        {!collapsed && (
          <>
            <p className="truncate px-2 text-sm font-medium">{adminName}</p>
            <p className="px-2 text-xs text-muted-foreground">{roleLabel}</p>
          </>
        )}
        <div className={`mt-3 ${collapsed ? "" : "px-2"}`}>
          <LogoutButton compact={collapsed} />
        </div>
      </div>
      </aside>
    </>
  );
}

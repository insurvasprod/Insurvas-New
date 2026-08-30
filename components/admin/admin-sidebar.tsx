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
  Tag,
  ToggleRight,
  TrendingUp,
  Undo2,
  UserRound,
  Users,
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
};

const COLLAPSED_KEY = "insurvas.admin.sidebar.collapsed";
const OPEN_GROUPS_KEY = "insurvas.admin.sidebar.openGroups";
const DEFAULT_OPEN_GROUPS = ["customers", "billing"];

const ACTIVE_STYLE = {
  borderColor: "rgba(255,255,255,0.22)",
  background: "linear-gradient(180deg, #00539c 0%, #003468 100%)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 8px 22px rgba(0,31,63,0.45)",
} as const;

type Props = { nodes: SidebarNode[]; adminName: string; roleLabel: string };

export function AdminSidebar({ nodes, adminName, roleLabel }: Props) {
  const pathname = usePathname();
  const activeGroupId = useMemo(() => groupIdForPath(nodes, pathname), [nodes, pathname]);

  const [collapsed, setCollapsed] = usePersistedState<boolean>(COLLAPSED_KEY, false);
  const [openGroups, setOpenGroups] = usePersistedState<string[]>(OPEN_GROUPS_KEY, DEFAULT_OPEN_GROUPS);
  const [flyout, setFlyout] = useState<string | null>(null);

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

  function renderLink(entry: Extract<SidebarNode, { kind: "link" }>, nested: boolean) {
    const Icon = ICONS[entry.icon];
    const active = isLinkActive(entry.href, pathname);

    return (
      <Link
        key={entry.href}
        href={entry.href}
        title={collapsed ? entry.label : undefined}
        className={`flex items-center gap-3 rounded-[14px] border text-[15px] transition-all ${
          collapsed ? "justify-center px-0 py-3" : nested ? "py-2.5 pl-11 pr-4" : "px-4 py-3"
        }`}
        style={{
          borderColor: active ? ACTIVE_STYLE.borderColor : "transparent",
          background: active ? ACTIVE_STYLE.background : "transparent",
          boxShadow: active ? ACTIVE_STYLE.boxShadow : "none",
          fontWeight: active ? 700 : nested ? 500 : 600,
          color: active || !nested ? "#ffffff" : "rgba(255,255,255,0.88)",
        }}
        onMouseEnter={(event) => {
          if (active) return;
          event.currentTarget.style.background = "rgba(255,255,255,0.10)";
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
    <aside
      data-print-hide
      className={`relative flex shrink-0 flex-col justify-between rounded-br-3xl p-4 text-white transition-[width] duration-200 ${
        collapsed ? "w-[76px]" : "w-60"
      }`}
      style={{
        background:
          "radial-gradient(760px 360px at 100% 0%, rgba(63,151,230,0.16) 0%, transparent 62%)," +
          "linear-gradient(135deg, #005ba8 0%, #00407f 32%, #003162 72%, #001f3f 100%)",
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
                  className={`flex w-full items-center gap-3 rounded-[14px] border border-transparent text-[15px] font-bold transition-all hover:bg-white/10 ${
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
                    className="absolute left-full top-0 z-50 ml-2 w-56 rounded-[16px] border border-white/20 p-2 shadow-[0_18px_46px_rgba(0,20,45,0.55)]"
                    style={{ background: "#00305f" }}
                  >
                    <p className="px-3 pb-2 pt-1 text-[11px] font-extrabold uppercase tracking-wider text-white/60">
                      {node.label}
                    </p>
                    {node.links.map((entry) => {
                      const active = isLinkActive(entry.href, pathname);
                      return (
                        <Link
                          key={entry.href}
                          href={entry.href}
                          className="block rounded-[10px] px-3 py-2 text-sm transition-colors hover:bg-white/10"
                          style={{
                            fontWeight: active ? 700 : 500,
                            background: active ? "rgba(255,255,255,0.14)" : "transparent",
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

      <div className="border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`mb-3 flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-xs text-white/70 transition-colors hover:bg-white/10 hover:text-white ${
            collapsed ? "justify-center" : ""
          }`}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          {!collapsed && <span>Collapse</span>}
        </button>

        {!collapsed && (
          <>
            <p className="truncate px-2 text-sm font-medium">{adminName}</p>
            <p className="px-2 text-xs text-white/70">{roleLabel}</p>
          </>
        )}
        <div className={`mt-3 ${collapsed ? "" : "px-2"}`}>
          <LogoutButton compact={collapsed} />
        </div>
      </div>
    </aside>
  );
}

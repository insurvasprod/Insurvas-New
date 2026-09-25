"use client";

import { createElement, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ChevronDown,
  Home,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings,
  Users,
  X,
} from "lucide-react";

import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { ThemeToggle } from "@/components/theme-toggle";

type PartnerStatus = "draft" | "active" | "paused" | "offboarded";
type PartnerNavItem = { label: string; path: string; icon: typeof Home };

const workspaceItems: PartnerNavItem[] = [
  { label: "Overview", path: "/partner", icon: Home },
  { label: "Submit lead", path: "/partner/submit-lead", icon: Send },
  { label: "Pipeline", path: "/partner/pipeline", icon: BarChart3 },
  { label: "Messages", path: "/partner/messages", icon: MessageSquare },
];

function isActivePath(pathname: string, path: string) {
  if (path === "/partner") return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function PartnerNavLink({ item, onNavigate }: { item: PartnerNavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = isActivePath(pathname, item.path);
  return (
    <li>
      <Link
        href={item.path}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`portal-agent-nav-link ${active ? "is-active" : ""}`}
      >
        <span className="portal-agent-nav-link-copy">
          {createElement(item.icon, { className: "portal-agent-nav-icon", "aria-hidden": true })}
          <span className="portal-agent-nav-label">{item.label}</span>
        </span>
      </Link>
    </li>
  );
}

function PartnerNav({ role, onNavigate }: { role: PartnerRole; onNavigate?: () => void }) {
  const pathname = usePathname();
  const teamActive = isActivePath(pathname, "/partner/team");
  const settingsActive = isActivePath(pathname, "/partner/settings");
  const statusItems: PartnerNavItem[] = [
    ...(role === "partner_admin" ? [{ label: "Team review", path: "/partner/team-review", icon: BarChart3 }, { label: "Team access", path: "/partner/team", icon: Users }] : []),
    { label: "Settings", path: "/partner/settings", icon: Settings },
  ];
  const orgActive = teamActive || settingsActive || isActivePath(pathname, "/partner/team-review");
  // Shut by default, as drawn; open whenever the page you are on lives inside it, so a deep link
  // never lands in a section that looks closed.
  const [orgOpen, setOrgOpen] = useState(orgActive);
  const open = orgOpen || orgActive;
  return (
    <nav className="portal-agent-nav" aria-label="Partner workspace navigation">
      <ul className="portal-agent-nav-home">
        {workspaceItems.map((item) => <PartnerNavLink key={item.path} item={item} onNavigate={onNavigate} />)}
      </ul>
      {/* A heading like the agent rail’s Business and Partners: 30px, uppercase, arrow first. It was a
          static 10px caption — under the smallest size the design system allows. */}
      <section className={`portal-agent-nav-section ${orgActive ? "is-active" : ""}`}>
        <button type="button" className="portal-agent-nav-disclosure" aria-expanded={open} aria-controls="partner-nav-organization" onClick={() => setOrgOpen((value) => !value)}>
          <span className="portal-agent-nav-disclosure-copy">
            <Settings className="portal-agent-nav-icon" aria-hidden="true" />
            <span>Organization</span>
          </span>
          <ChevronDown className={`portal-agent-nav-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
        </button>
        {open && (
          <ul id="partner-nav-organization">
            {statusItems.map((item) => <PartnerNavLink key={item.path} item={item} onNavigate={onNavigate} />)}
          </ul>
        )}
      </section>
    </nav>
  );
}

/**
 * The rail’s foot card — the agent plan card’s shape, holding what is true for a partner: which
 * organisation this is, and what you are in it. The board’s copy ("Growth · 12 seats · Owner") is
 * the agent’s placeholder and means nothing here.
 */
function PartnerCard({ role, partnerStatus, partnerName }: { role: PartnerRole; partnerStatus: PartnerStatus; partnerName: string }) {
  const statusLabel = { draft: "draft", active: "active", paused: "paused", offboarded: "offboarded" }[partnerStatus];
  return (
    <section className="portal-agent-plan-card" aria-label="Partner organisation">
      <p className="portal-agent-plan-card-label">Partner</p>
      <p className="portal-agent-plan-card-name truncate">{partnerName}</p>
      <p className="portal-agent-plan-card-role">{role === "partner_admin" ? "Partner admin" : "Partner user"} · {statusLabel}</p>
    </section>
  );
}

export function PartnerSidebar({ role, partnerStatus, partnerName, footer }: { role: PartnerRole; partnerStatus: PartnerStatus; partnerName: string; footer?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigation = <PartnerNav role={role} onNavigate={() => setOpen(false)} />;

  return (
    <>
      <header data-print-hide className="portal-agent-sidebar-mobile sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-card px-4 py-3 text-foreground md:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="-ml-1 rounded-md p-1.5 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
          <Menu className="size-5" aria-hidden="true" />
        </button>
        <div className="flex items-center gap-2.5"><span aria-hidden="true" className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-xs font-semibold text-[var(--on-primary)]">I</span><span className="text-sm font-semibold tracking-[-0.01em]">Insurvas partners</span></div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/50" />
          <div className="portal-agent-sidebar-mobile-drawer absolute inset-y-0 left-0 flex w-80 max-w-[88vw] flex-col overflow-y-auto p-4 text-foreground">
            <div className="min-h-0 flex-1">
              <div className="portal-agent-sidebar-brand"><div className="flex items-center gap-2.5"><span aria-hidden="true" className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-xs font-semibold text-[var(--on-primary)]">I</span><span className="text-sm font-semibold tracking-[-0.01em]">Insurvas partners</span></div><button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="portal-agent-sidebar-collapse rounded-md p-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"><X className="size-5" aria-hidden="true" /></button></div>
              {navigation}
              <PartnerCard role={role} partnerStatus={partnerStatus} partnerName={partnerName} />
            </div>
            {footer && <div className="portal-agent-sidebar-footer">{footer}</div>}
          </div>
        </div>
      )}

      <aside data-print-hide className={`portal-agent-sidebar-desktop hidden shrink-0 flex-col md:flex ${collapsed ? "is-collapsed" : ""}`} data-collapsed={collapsed}>
        <div className="portal-agent-sidebar-brand"><div className="flex items-center gap-2.5"><span aria-hidden="true" className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-lg bg-[var(--primary)] text-xs font-semibold text-[var(--on-primary)]">I</span><span className="text-sm font-semibold tracking-[-0.01em]">Insurvas partners</span></div><button type="button" className="portal-agent-sidebar-collapse rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}</button></div>
        <div className="portal-agent-sidebar-scroll min-h-0 flex-1">
          {navigation}
        </div>
        <PartnerCard role={role} partnerStatus={partnerStatus} partnerName={partnerName} />
        {footer && <div className="portal-agent-sidebar-footer">{footer}</div>}
      </aside>
    </>
  );
}

/** The theme toggle only. Sign-out is the labelled last row of the top bar’s account menu. */
export function PartnerSidebarFooter() {
  return <ThemeToggle tone="onBrand" />;
}
